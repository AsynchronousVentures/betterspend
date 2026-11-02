import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '@betterspend/db';
import {
  hashVendorPortalPassword,
  VENDOR_PORTAL_PASSWORD_MIN_LENGTH,
  vendorPortalSessions,
  vendorPortalUsers,
  vendors,
  verifyVendorPortalPassword,
} from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import type { AccessPolicy } from '../auth/access-policy';
import { VendorsService } from '../vendors/vendors.service';

export type VendorPortalUserStatus = 'active' | 'disabled';

export interface VendorPortalUserSummary {
  id: string;
  vendorId: string;
  email: string;
  name: string | null;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface CreateVendorPortalUserInput {
  vendorId: string;
  email: string;
  password: string;
  name?: string | null;
}

export interface PortalLoginIdentity {
  organizationId: string;
  vendorId: string;
  portalUserId: string;
}

const PUBLIC_COLUMNS = {
  id: vendorPortalUsers.id,
  vendorId: vendorPortalUsers.vendorId,
  email: vendorPortalUsers.email,
  name: vendorPortalUsers.name,
  status: vendorPortalUsers.status,
  lastLoginAt: vendorPortalUsers.lastLoginAt,
  createdAt: vendorPortalUsers.createdAt,
};

/** Hash compared against when no login matches, so failures take as long as successes. */
let missingUserHash: Promise<string> | undefined;
function getMissingUserHash(): Promise<string> {
  missingUserHash ??= hashVendorPortalPassword('vendor-portal-missing-user');
  return missingUserHash;
}

export function normalizePortalEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertPortalPasswordStrength(password: string): void {
  if (typeof password !== 'string' || password.length < VENDOR_PORTAL_PASSWORD_MIN_LENGTH) {
    throw new BadRequestException(
      `Password must be at least ${VENDOR_PORTAL_PASSWORD_MIN_LENGTH} characters`,
    );
  }
}

@Injectable()
export class VendorPortalUsersService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly vendorsService: VendorsService,
  ) {}

  /** Admin: list portal logins for one vendor. */
  async listForVendor(
    vendorId: string,
    organizationId: string,
    access?: AccessPolicy,
  ): Promise<VendorPortalUserSummary[]> {
    await this.vendorsService.findOne(vendorId, organizationId, access, 'vendors:view');
    return this.listByVendor(vendorId, organizationId);
  }

  /** Admin: create a login for a vendor contact. */
  async create(
    input: CreateVendorPortalUserInput,
    organizationId: string,
    access?: AccessPolicy,
  ): Promise<VendorPortalUserSummary> {
    await this.vendorsService.findOne(input.vendorId, organizationId, access, 'vendors:edit');
    return this.insertUser(input, organizationId);
  }

  /** Admin: replace a login's password and drop its open sessions. */
  async resetPassword(
    userId: string,
    password: string,
    organizationId: string,
    access?: AccessPolicy,
  ): Promise<{ success: true }> {
    const user = await this.requireUser(userId, organizationId);
    await this.vendorsService.findOne(user.vendorId, organizationId, access, 'vendors:edit');
    assertPortalPasswordStrength(password);
    await this.db
      .update(vendorPortalUsers)
      .set({ passwordHash: await hashVendorPortalPassword(password), updatedAt: new Date() })
      .where(eq(vendorPortalUsers.id, userId));
    await this.revokeUserSessions(userId);
    return { success: true };
  }

  /** Admin: enable or disable a login; disabling revokes its sessions. */
  async setStatus(
    userId: string,
    status: VendorPortalUserStatus,
    organizationId: string,
    access?: AccessPolicy,
  ): Promise<VendorPortalUserSummary> {
    if (status !== 'active' && status !== 'disabled') {
      throw new BadRequestException('Status must be active or disabled');
    }
    const user = await this.requireUser(userId, organizationId);
    await this.vendorsService.findOne(user.vendorId, organizationId, access, 'vendors:edit');
    const [updated] = await this.db
      .update(vendorPortalUsers)
      .set({ status, updatedAt: new Date() })
      .where(eq(vendorPortalUsers.id, userId))
      .returning(PUBLIC_COLUMNS);
    if (status === 'disabled') await this.revokeUserSessions(userId);
    return updated!;
  }

  /** Admin: delete a login (sessions cascade). */
  async remove(
    userId: string,
    organizationId: string,
    access?: AccessPolicy,
  ): Promise<{ success: true }> {
    const user = await this.requireUser(userId, organizationId);
    await this.vendorsService.findOne(user.vendorId, organizationId, access, 'vendors:edit');
    await this.db.delete(vendorPortalUsers).where(eq(vendorPortalUsers.id, userId));
    return { success: true };
  }

  /** Portal: verify an email/password pair. Never reveals which part was wrong. */
  async authenticate(email: string, password: string): Promise<PortalLoginIdentity> {
    const normalized = normalizePortalEmail(email ?? '');
    const invalid = () => new UnauthorizedException('Invalid email or password');
    if (!normalized || typeof password !== 'string' || !password) throw invalid();

    const [row] = await this.db
      .select({
        id: vendorPortalUsers.id,
        organizationId: vendorPortalUsers.organizationId,
        vendorId: vendorPortalUsers.vendorId,
        status: vendorPortalUsers.status,
        passwordHash: vendorPortalUsers.passwordHash,
        vendorStatus: vendors.status,
      })
      .from(vendorPortalUsers)
      .innerJoin(vendors, eq(vendors.id, vendorPortalUsers.vendorId))
      .where(eq(vendorPortalUsers.email, normalized))
      .orderBy(asc(vendorPortalUsers.createdAt))
      .limit(1);

    const matches = await verifyVendorPortalPassword(
      password,
      row?.passwordHash ?? (await getMissingUserHash()),
    );
    if (!row || !matches || row.status !== 'active' || row.vendorStatus === 'blocked') {
      throw invalid();
    }

    await this.db
      .update(vendorPortalUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(vendorPortalUsers.id, row.id));

    return { organizationId: row.organizationId, vendorId: row.vendorId, portalUserId: row.id };
  }

  /** Portal: the logins that belong to the signed-in vendor. */
  listByVendor(vendorId: string, organizationId: string): Promise<VendorPortalUserSummary[]> {
    return this.db
      .select(PUBLIC_COLUMNS)
      .from(vendorPortalUsers)
      .where(
        and(
          eq(vendorPortalUsers.vendorId, vendorId),
          eq(vendorPortalUsers.organizationId, organizationId),
        ),
      )
      .orderBy(asc(vendorPortalUsers.createdAt));
  }

  async findSummary(
    userId: string,
    organizationId: string,
  ): Promise<VendorPortalUserSummary | null> {
    const [row] = await this.db
      .select(PUBLIC_COLUMNS)
      .from(vendorPortalUsers)
      .where(
        and(eq(vendorPortalUsers.id, userId), eq(vendorPortalUsers.organizationId, organizationId)),
      )
      .limit(1);
    return row ?? null;
  }

  /** Portal: a vendor with a live session (link or login) adds a login for itself. */
  createForVendor(
    vendorId: string,
    organizationId: string,
    input: Omit<CreateVendorPortalUserInput, 'vendorId'>,
  ): Promise<VendorPortalUserSummary> {
    return this.insertUser({ ...input, vendorId }, organizationId);
  }

  /** Portal: change the signed-in login's own password. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: true }> {
    assertPortalPasswordStrength(newPassword);
    const [row] = await this.db
      .select({ passwordHash: vendorPortalUsers.passwordHash })
      .from(vendorPortalUsers)
      .where(eq(vendorPortalUsers.id, userId))
      .limit(1);
    if (!row || !(await verifyVendorPortalPassword(currentPassword ?? '', row.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.db
      .update(vendorPortalUsers)
      .set({ passwordHash: await hashVendorPortalPassword(newPassword), updatedAt: new Date() })
      .where(eq(vendorPortalUsers.id, userId));
    return { success: true };
  }

  private async insertUser(
    input: CreateVendorPortalUserInput,
    organizationId: string,
  ): Promise<VendorPortalUserSummary> {
    const email = normalizePortalEmail(input.email ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('A valid email address is required');
    }
    assertPortalPasswordStrength(input.password);

    const [existing] = await this.db
      .select({ id: vendorPortalUsers.id })
      .from(vendorPortalUsers)
      .where(
        and(
          eq(vendorPortalUsers.organizationId, organizationId),
          eq(vendorPortalUsers.email, email),
        ),
      )
      .limit(1);
    if (existing) throw new ConflictException('A portal login with that email already exists');

    const [created] = await this.db
      .insert(vendorPortalUsers)
      .values({
        organizationId,
        vendorId: input.vendorId,
        email,
        name: input.name?.trim() || null,
        passwordHash: await hashVendorPortalPassword(input.password),
      })
      .returning(PUBLIC_COLUMNS);
    return created!;
  }

  private async requireUser(userId: string, organizationId: string) {
    const [user] = await this.db
      .select({ id: vendorPortalUsers.id, vendorId: vendorPortalUsers.vendorId })
      .from(vendorPortalUsers)
      .where(
        and(eq(vendorPortalUsers.id, userId), eq(vendorPortalUsers.organizationId, organizationId)),
      )
      .limit(1);
    if (!user) throw new NotFoundException('Portal login not found');
    return user;
  }

  private async revokeUserSessions(userId: string): Promise<void> {
    await this.db
      .update(vendorPortalSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(vendorPortalSessions.portalUserId, userId), isNull(vendorPortalSessions.revokedAt)),
      );
  }
}
