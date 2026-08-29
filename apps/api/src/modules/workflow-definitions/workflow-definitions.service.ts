import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type {
  CreateWorkflowDefinitionInput,
  WorkflowDomain,
  WorkflowDraft,
  WorkflowAssistantProposalRequest,
  WorkflowAssistantProposalResponse,
  WorkflowDraftLeaseStatus,
} from '@betterspend/shared';
import {
  compileWorkflowGraph,
  workflowAssistantProposalRequestSchema,
  workflowDraftSchema,
} from '@betterspend/shared';
import type { Db } from '@betterspend/db';
import { users, workflowDefinitions, workflowDefinitionVersions } from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import { EntitiesService } from '../entities/entities.service';
import { WorkflowAssistantService } from './workflow-assistant.service';
import { WorkflowDraftLeaseService } from './workflow-draft-lease.service';

function newWorkflowDraft(domain: WorkflowDomain): WorkflowDraft {
  const event = {
    requisition: 'requisition_submitted',
    invoice: 'invoice_submitted',
    po_change: 'po_change_submitted',
  } as const;

  return workflowDraftSchema.parse({
    graph: {
      schemaVersion: 1,
      domain,
      entryNodeId: 'trigger',
      nodes: [
        {
          id: 'trigger',
          name: 'Submitted',
          type: 'trigger',
          config: { event: event[domain] },
        },
        { id: 'approved', name: 'Approved', type: 'approved', config: {} },
      ],
      edges: [
        {
          id: 'trigger-to-approved',
          sourceNodeId: 'trigger',
          sourceHandle: 'out',
          targetNodeId: 'approved',
          targetHandle: 'in',
        },
      ],
    },
    positions: {},
  });
}

@Injectable()
export class WorkflowDefinitionsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly entities: EntitiesService,
    private readonly audit: AuditService,
    private readonly leases: WorkflowDraftLeaseService,
    @Optional() private readonly assistant?: WorkflowAssistantService,
  ) {}

  findAll(organizationId: string, domain?: WorkflowDomain) {
    return this.db.query.workflowDefinitions.findMany({
      where: (definition, { and, eq }) =>
        and(
          eq(definition.organizationId, organizationId),
          domain ? eq(definition.domain, domain) : undefined,
        ),
      with: { publishedVersion: true },
      orderBy: (definition, { asc }) => asc(definition.name),
    });
  }

  async findOne(id: string, organizationId: string) {
    const definition = await this.db.query.workflowDefinitions.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.id, id), eq(record.organizationId, organizationId)),
      with: { publishedVersion: true },
    });
    if (!definition) throw new NotFoundException(`Workflow definition ${id} not found`);
    return definition;
  }

  async create(organizationId: string, userId: string, input: CreateWorkflowDefinitionInput) {
    await this.entities.assertBelongsToOrg(organizationId, input.entityId ?? undefined);
    const draft = input.draft ?? newWorkflowDraft(input.domain);
    this.assertDraftDomain(input.domain, draft);

    const definition = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(workflowDefinitions)
        .values({
          organizationId,
          entityId: input.entityId ?? null,
          domain: input.domain,
          name: input.name,
          currentDraft: draft,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      await this.audit.log(
        organizationId,
        userId,
        'workflow_definition',
        created.id,
        'created',
        { domain: input.domain, name: input.name },
        undefined,
        tx,
      );
      return created;
    });
    return this.findOne(definition.id, organizationId);
  }

  async saveDraft(
    id: string,
    organizationId: string,
    userId: string,
    draft: WorkflowDraft,
    leaseToken?: string,
  ) {
    await this.db.transaction(async (tx) => {
      const [definition] = await tx
        .select({ domain: workflowDefinitions.domain })
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.id, id),
            eq(workflowDefinitions.organizationId, organizationId),
          ),
        )
        .for('update');
      if (!definition) throw new NotFoundException(`Workflow definition ${id} not found`);
      await this.assertOwnedLease(id, organizationId, userId, leaseToken);
      this.assertDraftDomain(definition.domain as WorkflowDomain, draft);

      await tx
        .update(workflowDefinitions)
        .set({ currentDraft: draft, updatedBy: userId, updatedAt: new Date() })
        .where(eq(workflowDefinitions.id, id));
      await this.audit.log(
        organizationId,
        userId,
        'workflow_definition',
        id,
        'draft_saved',
        undefined,
        undefined,
        tx,
      );
    });
    return this.findOne(id, organizationId);
  }

  async publish(id: string, organizationId: string, userId: string, leaseToken?: string) {
    const published = await this.db.transaction(async (tx) => {
      const [definition] = await tx
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.id, id),
            eq(workflowDefinitions.organizationId, organizationId),
          ),
        )
        .for('update');
      if (!definition) throw new NotFoundException(`Workflow definition ${id} not found`);
      await this.assertOwnedLease(id, organizationId, userId, leaseToken);

      const compilation = compileWorkflowGraph(definition.currentDraft.graph);
      if (!compilation.success) {
        throw new BadRequestException({
          message: 'Workflow draft is not publishable',
          issues: compilation.issues,
        });
      }

      const [latest] = await tx
        .select({ version: workflowDefinitionVersions.version })
        .from(workflowDefinitionVersions)
        .where(eq(workflowDefinitionVersions.definitionId, id))
        .orderBy(desc(workflowDefinitionVersions.version))
        .limit(1);

      const [version] = await tx
        .insert(workflowDefinitionVersions)
        .values({
          definitionId: id,
          organizationId,
          version: (latest?.version ?? 0) + 1,
          graphJson: compilation.graph,
          positionsJson: definition.currentDraft.positions,
          executableJson: compilation.executable,
          publishedBy: userId,
        })
        .returning();

      await tx
        .update(workflowDefinitions)
        .set({ publishedVersionId: version.id, updatedBy: userId, updatedAt: new Date() })
        .where(eq(workflowDefinitions.id, id));
      await this.audit.log(
        organizationId,
        userId,
        'workflow_definition',
        id,
        'published',
        { version: version.version, versionId: version.id },
        undefined,
        tx,
      );
      return version;
    });
    return published;
  }

  async listVersions(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    return this.db.query.workflowDefinitionVersions.findMany({
      where: (version, { eq }) => eq(version.definitionId, id),
      orderBy: (version, { desc }) => desc(version.version),
    });
  }

  async restoreVersion(
    id: string,
    versionId: string,
    organizationId: string,
    userId: string,
    leaseToken?: string,
  ) {
    const restored = await this.db.transaction(async (tx) => {
      const [definition] = await tx
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.id, id),
            eq(workflowDefinitions.organizationId, organizationId),
          ),
        )
        .for('update');
      if (!definition) throw new NotFoundException(`Workflow definition ${id} not found`);
      await this.assertOwnedLease(id, organizationId, userId, leaseToken);

      const version = await tx.query.workflowDefinitionVersions.findFirst({
        where: (record, { and, eq }) =>
          and(eq(record.id, versionId), eq(record.definitionId, definition.id)),
      });
      if (!version)
        throw new NotFoundException(`Workflow definition version ${versionId} not found`);

      const draft = workflowDraftSchema.parse({
        graph: version.graphJson,
        positions: version.positionsJson,
      });
      await tx
        .update(workflowDefinitions)
        .set({ currentDraft: draft, updatedBy: userId, updatedAt: new Date() })
        .where(eq(workflowDefinitions.id, definition.id));
      await this.audit.log(
        organizationId,
        userId,
        'workflow_definition',
        id,
        'version_restored_as_draft',
        { version: version.version, versionId },
        undefined,
        tx,
      );
      return { definitionId: definition.id, restoredFromVersion: version.version, draft };
    });
    return restored;
  }

  async getDraftLease(
    id: string,
    organizationId: string,
    userId: string,
  ): Promise<WorkflowDraftLeaseStatus> {
    await this.findOne(id, organizationId);
    return this.requireLeases().status(id, organizationId, userId);
  }

  async acquireDraftLease(
    id: string,
    organizationId: string,
    userId: string,
    holderName?: string,
  ): Promise<WorkflowDraftLeaseStatus> {
    await this.findOne(id, organizationId);
    return this.requireLeases().acquire(
      id,
      organizationId,
      userId,
      await this.resolveHolderName(organizationId, userId, holderName),
    );
  }

  async renewDraftLease(
    id: string,
    organizationId: string,
    userId: string,
    leaseToken: string,
  ): Promise<WorkflowDraftLeaseStatus> {
    await this.findOne(id, organizationId);
    return this.requireLeases().renew(id, organizationId, userId, leaseToken);
  }

  async releaseDraftLease(
    id: string,
    organizationId: string,
    userId: string,
    leaseToken: string,
  ): Promise<WorkflowDraftLeaseStatus> {
    await this.findOne(id, organizationId);
    return this.requireLeases().release(id, organizationId, userId, leaseToken);
  }

  async takeoverDraftLease(
    id: string,
    organizationId: string,
    userId: string,
    holderName?: string,
  ): Promise<WorkflowDraftLeaseStatus> {
    await this.findOne(id, organizationId);
    const leases = this.requireLeases();
    const previous = await leases.peek(id, organizationId);
    const status = await leases.takeover(
      id,
      organizationId,
      userId,
      await this.resolveHolderName(organizationId, userId, holderName),
    );
    await this.audit.log(
      organizationId,
      userId,
      'workflow_definition',
      id,
      'draft_lease_taken_over',
      previous
        ? {
            previousHolderUserId: previous.holderUserId,
            previousHolderName: previous.holderName,
            previousExpiresAt: previous.expiresAt,
          }
        : undefined,
    );
    return status;
  }

  async proposeAssistant(
    id: string,
    organizationId: string,
    input: WorkflowAssistantProposalRequest,
  ): Promise<WorkflowAssistantProposalResponse> {
    const parsed = workflowAssistantProposalRequestSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid workflow assistant request');
    const definition = await this.findOne(id, organizationId);
    if (parsed.data.graph.domain !== definition.domain) {
      throw new BadRequestException(
        `Workflow graph domain ${parsed.data.graph.domain} does not match definition domain ${definition.domain}`,
      );
    }
    if (!this.assistant) {
      throw new ServiceUnavailableException('Workflow assistant is unavailable');
    }
    return this.assistant.propose(organizationId, parsed.data);
  }

  private assertDraftDomain(domain: WorkflowDomain, draft: WorkflowDraft): void {
    if (draft.graph.domain !== domain) {
      throw new BadRequestException(
        `Workflow draft domain ${draft.graph.domain} does not match definition domain ${domain}`,
      );
    }
  }

  private async assertOwnedLease(
    id: string,
    organizationId: string,
    userId: string,
    leaseToken?: string,
  ): Promise<void> {
    await this.leases.assertOwned(id, organizationId, userId, leaseToken ?? '');
  }

  private requireLeases(): WorkflowDraftLeaseService {
    return this.leases;
  }

  private async resolveHolderName(
    organizationId: string,
    userId: string,
    suppliedName?: string,
  ): Promise<string> {
    if (suppliedName?.trim()) return suppliedName.trim();
    const user = await this.db.query.users.findFirst({
      where: (record, { and, eq }) =>
        and(
          eq(record.id, userId),
          eq(record.organizationId, organizationId),
          eq(record.isActive, true),
        ),
    });
    if (!user?.name) throw new NotFoundException('Current user not found');
    return user.name;
  }
}
