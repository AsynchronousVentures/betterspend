import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { asc, eq, and, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DB_TOKEN } from '../../database/database.module';
import type { Db, DbTransaction } from '@betterspend/db';
import {
  users,
  userRoles,
  authAccounts,
  authSessions,
  customRoles,
  departments,
  projects,
  legalEntities,
} from '@betterspend/db';
import {
  builtInRoleSchema,
  BUILT_IN_ROLE_PERMISSIONS,
  hasPaymentReleasePermissionConflict,
  normalizePermissions,
  PERMISSION_CATALOG,
  userRoleAssignmentSchema,
  type PermissionKey,
  type ScopeType,
} from '@betterspend/shared';
import { hashCredentialPassword } from '../../auth/credential-password';
import { AuditService } from '../audit/audit.service';

const EMAIL_UNIQUE_CONSTRAINTS = new Set(['users_email_unique', 'users_email_normalized_unique']);
const PAYMENT_RELEASE_CONFLICT_MESSAGE =
  'A user cannot hold both payment release and vendor payment-detail permissions';

function permissionsForRole(role: string, customPermissions: unknown): readonly PermissionKey[] {
  const builtIn = builtInRoleSchema.safeParse(role);
  if (builtIn.success) return BUILT_IN_ROLE_PERMISSIONS[builtIn.data];
  if (role === 'custom') return normalizePermissions(customPermissions);
  return [];
}

export function sortUniqueIdsForLocking(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function assertPaymentReleaseSeparation(permissions: Iterable<PermissionKey>): void {
  if (hasPaymentReleasePermissionConflict(permissions)) {
    throw new BadRequestException(PAYMENT_RELEASE_CONFLICT_MESSAGE);
  }
}

function isEmailUniqueViolation(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as Record<string, unknown>;
    if (
      candidate.code === '23505' &&
      typeof candidate.constraint_name === 'string' &&
      EMAIL_UNIQUE_CONSTRAINTS.has(candidate.constraint_name)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as Record<string, unknown>;
    if (candidate.code === '23505') return true;
    current = candidate.cause;
  }
  return false;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async findAll(organizationId: string) {
    return this.db.query.users.findMany({
      where: eq(users.organizationId, organizationId),
      with: { userRoles: { with: { customRole: true } } },
      orderBy: (u, { asc }) => asc(u.name),
    });
  }

  async findOne(id: string, organizationId: string) {
    const user = await this.db.query.users.findFirst({
      where: (u, { and, eq }) => and(eq(u.id, id), eq(u.organizationId, organizationId)),
      with: { userRoles: { with: { customRole: true } } },
    });

    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async update(
    id: string,
    organizationId: string,
    data: { name?: string; departmentId?: string | null; isActive?: boolean },
    actorUserId?: string,
  ) {
    const [updated] = await this.db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.organizationId, organizationId)))
        .for('update');
      if (!existing) throw new NotFoundException(`User ${id} not found`);
      if (data.departmentId)
        await this.assertScopeTarget(organizationId, 'department', data.departmentId, transaction);

      const [next] = await transaction
        .update(users)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(users.id, id), eq(users.organizationId, organizationId)))
        .returning();

      if (!next) throw new NotFoundException(`User ${id} not found`);
      const activeChanged = data.isActive !== undefined && existing.isActive !== data.isActive;
      const profileChanged =
        (data.name !== undefined && existing.name !== data.name) ||
        (data.departmentId !== undefined && existing.departmentId !== data.departmentId);
      if (activeChanged) {
        if (data.isActive === false) {
          await transaction.delete(authSessions).where(eq(authSessions.userId, id));
        }
        await this.audit.log(
          organizationId,
          actorUserId ?? null,
          'user',
          id,
          data.isActive ? 'activated' : 'deactivated',
          { isActive: data.isActive },
          undefined,
          transaction,
        );
      }
      if (profileChanged) {
        await this.audit.log(
          organizationId,
          actorUserId ?? null,
          'user',
          id,
          'updated',
          { name: next.name, departmentId: next.departmentId },
          undefined,
          transaction,
        );
      }
      return [next] as const;
    });
    return this.findOne(updated.id, organizationId);
  }

  async addRole(
    userId: string,
    organizationId: string,
    data: { role?: string; customRoleId?: string; scopeType?: string; scopeId?: string | null },
    actorUserId?: string,
  ) {
    const assignment = this.parseRoleAssignment(data);

    try {
      return await this.db.transaction(async (transaction) => {
        let candidatePermissions: readonly PermissionKey[];
        if (assignment.customRoleId) {
          const [customRole] = await transaction
            .select({ id: customRoles.id, permissions: customRoles.permissions })
            .from(customRoles)
            .where(
              and(
                eq(customRoles.id, assignment.customRoleId),
                eq(customRoles.organizationId, organizationId),
              ),
            )
            .for('update');
          if (!customRole)
            throw new NotFoundException(`Custom role ${assignment.customRoleId} not found`);
          candidatePermissions = permissionsForRole('custom', customRole.permissions);
        } else {
          candidatePermissions = permissionsForRole(assignment.role!, undefined);
        }
        const [user] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)))
          .for('update');
        if (!user) throw new NotFoundException(`User ${userId} not found`);
        await this.assertUserPaymentReleaseSeparation(
          transaction,
          organizationId,
          userId,
          candidatePermissions,
        );
        await this.assertScopeTarget(
          organizationId,
          assignment.scopeType,
          assignment.scopeId,
          transaction,
        );
        const [role] = await transaction
          .insert(userRoles)
          .values({
            userId,
            organizationId,
            role: assignment.role ?? 'custom',
            customRoleId: assignment.customRoleId ?? null,
            scopeType: assignment.scopeType,
            scopeId: assignment.scopeId,
          })
          .returning();
        if (!role) throw new BadRequestException('Role assignment could not be created');
        await this.audit.log(
          organizationId,
          actorUserId ?? null,
          'user_role',
          role.id,
          'assigned',
          {
            userId,
            role: role.role,
            customRoleId: role.customRoleId,
            scopeType: role.scopeType,
            scopeId: role.scopeId,
          },
          undefined,
          transaction,
        );
        return role;
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('This role assignment already exists');
      }
      throw error;
    }
  }

  async removeRole(userId: string, roleId: string, organizationId: string, actorUserId?: string) {
    await this.findOne(userId, organizationId);
    await this.db.transaction(async (transaction) => {
      const [assignment] = await transaction
        .select()
        .from(userRoles)
        .where(and(eq(userRoles.id, roleId), eq(userRoles.userId, userId)))
        .limit(1);
      if (!assignment) throw new NotFoundException(`Role assignment ${roleId} not found`);
      await transaction.delete(userRoles).where(eq(userRoles.id, roleId));
      await this.audit.log(
        organizationId,
        actorUserId ?? null,
        'user_role',
        roleId,
        'removed',
        { userId, role: assignment.role, customRoleId: assignment.customRoleId },
        undefined,
        transaction,
      );
    });
  }

  async create(
    organizationId: string,
    data: { name: string; email: string; password: string; role?: string },
    actorUserId?: string,
  ) {
    const email = data.email.trim().toLowerCase();
    const existing = await this.db.query.users.findFirst({
      where: sql`lower(${users.email}) = ${email}`,
    });
    if (existing) throw new ConflictException(`Email ${email} is already in use`);
    const userId = randomUUID();
    const password = await hashCredentialPassword(data.password);
    const role = data.role
      ? builtInRoleSchema.safeParse(data.role)
      : { success: true as const, data: undefined };
    if (!role.success) throw new BadRequestException('Unknown built-in role');
    try {
      await this.db.transaction(async (transaction) => {
        await transaction.insert(users).values({
          id: userId,
          organizationId,
          email,
          name: data.name,
          emailVerified: true,
        });
        await transaction.insert(authAccounts).values({
          id: randomUUID(),
          userId,
          issuer: 'local:credential',
          accountId: userId,
          providerId: 'credential',
          password,
        });

        await this.audit.log(
          organizationId,
          actorUserId ?? null,
          'user',
          userId,
          'created',
          { email, name: data.name.trim() },
          undefined,
          transaction,
        );

        if (role.data) {
          const [assignment] = await transaction
            .insert(userRoles)
            .values({
              userId,
              organizationId,
              role: role.data,
              scopeType: 'global',
            })
            .returning({ id: userRoles.id });
          if (!assignment) throw new BadRequestException('Role assignment could not be created');
          await this.audit.log(
            organizationId,
            actorUserId ?? null,
            'user_role',
            assignment.id,
            'assigned',
            { userId, role: role.data, scopeType: 'global', scopeId: null },
            undefined,
            transaction,
          );
        }
      });
    } catch (error: unknown) {
      if (isEmailUniqueViolation(error)) {
        throw new ConflictException(`Email ${email} is already in use`);
      }
      throw error;
    }

    return this.findOne(userId, organizationId);
  }

  permissionsCatalog() {
    return PERMISSION_CATALOG;
  }

  async listCustomRoles(organizationId: string) {
    return this.db.query.customRoles.findMany({
      where: eq(customRoles.organizationId, organizationId),
      orderBy: (role, { asc }) => asc(role.name),
    });
  }

  async createCustomRole(
    organizationId: string,
    data: { name?: string; description?: string; permissions?: unknown },
    actorUserId?: string,
  ) {
    const name = data.name?.trim();
    if (!name) throw new BadRequestException('Role name is required');
    const permissions = normalizePermissions(data.permissions);
    assertPaymentReleaseSeparation(permissions);
    await this.assertUniqueCustomRoleName(organizationId, name);

    return this.db.transaction(async (transaction) => {
      const [role] = await transaction
        .insert(customRoles)
        .values({
          organizationId,
          name,
          description: data.description?.trim() || null,
          permissions,
        })
        .returning();
      if (!role) throw new BadRequestException('Custom role could not be created');
      await this.audit.log(
        organizationId,
        actorUserId ?? null,
        'custom_role',
        role.id,
        'created',
        { name: role.name, permissions: role.permissions },
        undefined,
        transaction,
      );
      return role;
    });
  }

  async updateCustomRole(
    id: string,
    organizationId: string,
    data: { name?: string; description?: string | null; permissions?: unknown },
    actorUserId?: string,
  ) {
    const existing = await this.findCustomRole(id, organizationId);
    const nextName = data.name?.trim() || existing.name;
    if (nextName.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertUniqueCustomRoleName(organizationId, nextName, id);
    }

    const nextPermissions =
      data.permissions === undefined
        ? normalizePermissions(existing.permissions)
        : normalizePermissions(data.permissions);
    assertPaymentReleaseSeparation(nextPermissions);
    const permissionsChanged =
      JSON.stringify([...normalizePermissions(existing.permissions)].sort()) !==
      JSON.stringify([...nextPermissions].sort());
    const nextDescription =
      data.description === undefined ? existing.description : data.description?.trim() || null;

    return this.db.transaction(async (transaction) => {
      const [lockedRole] = await transaction
        .select({ id: customRoles.id })
        .from(customRoles)
        .where(and(eq(customRoles.id, id), eq(customRoles.organizationId, organizationId)))
        .for('update');
      if (!lockedRole) throw new NotFoundException(`Custom role ${id} not found`);
      await this.assertAssignedUsersPaymentReleaseSeparation(
        transaction,
        organizationId,
        id,
        nextPermissions,
      );
      const [role] = await transaction
        .update(customRoles)
        .set({
          name: nextName,
          description: nextDescription,
          permissions: nextPermissions,
          updatedAt: new Date(),
        })
        .where(and(eq(customRoles.id, id), eq(customRoles.organizationId, organizationId)))
        .returning();
      if (!role) throw new NotFoundException(`Custom role ${id} not found`);
      if (permissionsChanged) {
        await this.audit.log(
          organizationId,
          actorUserId ?? null,
          'custom_role',
          id,
          'permissions_changed',
          { previous: normalizePermissions(existing.permissions), next: nextPermissions },
          undefined,
          transaction,
        );
      }
      if (nextName !== existing.name || nextDescription !== existing.description) {
        await this.audit.log(
          organizationId,
          actorUserId ?? null,
          'custom_role',
          id,
          'updated',
          { name: nextName, description: role.description },
          undefined,
          transaction,
        );
      }
      return role;
    });
  }

  async deleteCustomRole(id: string, organizationId: string, actorUserId?: string) {
    await this.findCustomRole(id, organizationId);
    await this.db.transaction(async (transaction) => {
      const assignments = await transaction
        .select()
        .from(userRoles)
        .where(eq(userRoles.customRoleId, id));
      await transaction.delete(userRoles).where(eq(userRoles.customRoleId, id));
      for (const assignment of assignments) {
        await this.audit.log(
          organizationId,
          actorUserId ?? null,
          'user_role',
          assignment.id,
          'removed',
          { userId: assignment.userId, customRoleId: id, reason: 'custom_role_deleted' },
          undefined,
          transaction,
        );
      }
      const [deleted] = await transaction
        .delete(customRoles)
        .where(and(eq(customRoles.id, id), eq(customRoles.organizationId, organizationId)))
        .returning({ id: customRoles.id });
      if (!deleted) throw new NotFoundException(`Custom role ${id} not found`);
      await this.audit.log(
        organizationId,
        actorUserId ?? null,
        'custom_role',
        id,
        'deleted',
        {},
        undefined,
        transaction,
      );
    });
  }

  private async findCustomRole(id: string, organizationId: string) {
    const role = await this.db.query.customRoles.findFirst({
      where: (r, { and, eq }) => and(eq(r.id, id), eq(r.organizationId, organizationId)),
    });
    if (!role) throw new NotFoundException(`Custom role ${id} not found`);
    return role;
  }

  private async assertUserPaymentReleaseSeparation(
    transaction: DbTransaction,
    organizationId: string,
    userId: string,
    candidatePermissions: readonly PermissionKey[],
  ) {
    const assignments = await transaction
      .select({
        role: userRoles.role,
        customRoleId: userRoles.customRoleId,
      })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.organizationId, organizationId)))
      .for('update');
    const customRoleIds = assignments.flatMap((assignment) =>
      assignment.customRoleId ? [assignment.customRoleId] : [],
    );
    const customRolePermissions = new Map<string, unknown>();
    if (customRoleIds.length > 0) {
      const customRolesForUser = await transaction
        .select({ id: customRoles.id, permissions: customRoles.permissions })
        .from(customRoles)
        .where(
          and(
            eq(customRoles.organizationId, organizationId),
            inArray(customRoles.id, customRoleIds),
          ),
        );
      customRolesForUser.forEach((role) => customRolePermissions.set(role.id, role.permissions));
    }

    const existingPermissions = assignments.flatMap((assignment) =>
      permissionsForRole(
        assignment.role,
        assignment.customRoleId ? customRolePermissions.get(assignment.customRoleId) : undefined,
      ),
    );
    assertPaymentReleaseSeparation([...existingPermissions, ...candidatePermissions]);
  }

  private async assertAssignedUsersPaymentReleaseSeparation(
    transaction: DbTransaction,
    organizationId: string,
    customRoleId: string,
    nextPermissions: readonly PermissionKey[],
  ) {
    const assignedRows = await transaction
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(
        and(eq(userRoles.organizationId, organizationId), eq(userRoles.customRoleId, customRoleId)),
      );
    const userIds = sortUniqueIdsForLocking(assignedRows.map((assignment) => assignment.userId));
    if (userIds.length === 0) return;

    await transaction
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), inArray(users.id, userIds)))
      .orderBy(asc(users.id))
      .for('update');

    const assignments = await transaction
      .select({
        userId: userRoles.userId,
        role: userRoles.role,
        customRoleId: userRoles.customRoleId,
      })
      .from(userRoles)
      .where(and(eq(userRoles.organizationId, organizationId), inArray(userRoles.userId, userIds)))
      .orderBy(asc(userRoles.userId), asc(userRoles.id))
      .for('update');
    const customRoleIds = [
      ...new Set(
        assignments.flatMap((assignment) =>
          assignment.customRoleId ? [assignment.customRoleId] : [],
        ),
      ),
    ];
    const customRolePermissions = new Map<string, unknown>();
    if (customRoleIds.length > 0) {
      const customRolesForUsers = await transaction
        .select({ id: customRoles.id, permissions: customRoles.permissions })
        .from(customRoles)
        .where(
          and(
            eq(customRoles.organizationId, organizationId),
            inArray(customRoles.id, customRoleIds),
          ),
        );
      customRolesForUsers.forEach((role) => customRolePermissions.set(role.id, role.permissions));
    }

    for (const userId of userIds) {
      const permissions = assignments
        .filter((assignment) => assignment.userId === userId)
        .flatMap((assignment) =>
          assignment.customRoleId === customRoleId
            ? nextPermissions
            : permissionsForRole(
                assignment.role,
                assignment.customRoleId
                  ? customRolePermissions.get(assignment.customRoleId)
                  : undefined,
              ),
        );
      assertPaymentReleaseSeparation(permissions);
    }
  }

  private parseRoleAssignment(data: {
    role?: string;
    customRoleId?: string;
    scopeType?: string;
    scopeId?: string | null;
  }) {
    const parsed = userRoleAssignmentSchema.safeParse({
      role: data.role,
      customRoleId: data.customRoleId,
      scopeType: data.scopeType ?? 'global',
      scopeId: data.scopeId ?? null,
    });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid role assignment');
    }
    return parsed.data;
  }

  private async assertScopeTarget(
    organizationId: string,
    scopeType: ScopeType,
    scopeId: string | null = null,
    database: Db | DbTransaction = this.db,
  ): Promise<void> {
    if (scopeType === 'global') return;
    if (!scopeId) throw new BadRequestException(`${scopeType} assignments require a scopeId`);

    let exists = false;
    if (scopeType === 'department') {
      const [department] = await database
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.id, scopeId), eq(departments.organizationId, organizationId)))
        .for('share');
      exists = Boolean(department);
    } else if (scopeType === 'project') {
      const [project] = await database
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, scopeId), eq(projects.organizationId, organizationId)))
        .for('share');
      exists = Boolean(project);
    } else if (scopeType === 'entity') {
      const [entity] = await database
        .select({ id: legalEntities.id })
        .from(legalEntities)
        .where(and(eq(legalEntities.id, scopeId), eq(legalEntities.organizationId, organizationId)))
        .for('share');
      exists = Boolean(entity);
    }

    if (!exists) {
      throw new BadRequestException(`The ${scopeType} scope target is not in this organization`);
    }
  }

  private async assertUniqueCustomRoleName(
    organizationId: string,
    name: string,
    ignoreId?: string,
  ) {
    const roles = await this.listCustomRoles(organizationId);
    const duplicate = roles.find(
      (role) => role.name.toLowerCase() === name.toLowerCase() && role.id !== ignoreId,
    );
    if (duplicate) throw new ConflictException(`Custom role "${name}" already exists`);
  }
}
