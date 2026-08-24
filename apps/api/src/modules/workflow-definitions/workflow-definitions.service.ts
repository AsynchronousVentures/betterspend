import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type {
  CreateWorkflowDefinitionInput,
  WorkflowDomain,
  WorkflowDraft,
} from '@betterspend/shared';
import {
  compileWorkflowGraph,
  executableDefinitionSchema,
  workflowDraftSchema,
} from '@betterspend/shared';
import type { Db } from '@betterspend/db';
import {
  approvalActions,
  approvalRequests,
  workflowDefinitions,
  workflowDefinitionVersions,
} from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import { EntitiesService } from '../entities/entities.service';

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

    const [definition] = await this.db
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

    this.audit
      .log(organizationId, userId, 'workflow_definition', definition.id, 'created', {
        domain: input.domain,
        name: input.name,
      })
      .catch(() => {});
    return this.findOne(definition.id, organizationId);
  }

  async saveDraft(id: string, organizationId: string, userId: string, draft: WorkflowDraft) {
    const definition = await this.findOne(id, organizationId);
    this.assertDraftDomain(definition.domain as WorkflowDomain, draft);

    await this.db
      .update(workflowDefinitions)
      .set({ currentDraft: draft, updatedBy: userId, updatedAt: new Date() })
      .where(
        and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.organizationId, organizationId)),
      );

    this.audit
      .log(organizationId, userId, 'workflow_definition', id, 'draft_saved')
      .catch(() => {});
    return this.findOne(id, organizationId);
  }

  async publish(id: string, organizationId: string, userId: string) {
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
      return version;
    });

    this.audit
      .log(organizationId, userId, 'workflow_definition', id, 'published', {
        version: published.version,
        versionId: published.id,
      })
      .catch(() => {});
    return published;
  }

  async listVersions(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    return this.db.query.workflowDefinitionVersions.findMany({
      where: (version, { eq }) => eq(version.definitionId, id),
      orderBy: (version, { desc }) => desc(version.version),
    });
  }

  async restoreVersion(id: string, versionId: string, organizationId: string, userId: string) {
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
      return { definitionId: definition.id, restoredFromVersion: version.version, draft };
    });

    this.audit
      .log(organizationId, userId, 'workflow_definition', id, 'version_restored_as_draft', {
        version: restored.restoredFromVersion,
        versionId,
      })
      .catch(() => {});
    return restored;
  }

  async restartInstanceOnLatest(approvalRequestId: string, organizationId: string, userId: string) {
    const restarted = await this.db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, approvalRequestId))
        .for('update');
      if (!request?.definitionVersionId) {
        throw new NotFoundException(`Versioned approval request ${approvalRequestId} not found`);
      }
      if (request.status !== 'pending') {
        throw new ConflictException('Only pending workflow instances can be restarted');
      }

      const [scope] = await tx
        .select({
          definitionId: workflowDefinitionVersions.definitionId,
        })
        .from(workflowDefinitionVersions)
        .innerJoin(
          workflowDefinitions,
          eq(workflowDefinitions.id, workflowDefinitionVersions.definitionId),
        )
        .where(
          and(
            eq(workflowDefinitionVersions.id, request.definitionVersionId),
            eq(workflowDefinitions.organizationId, organizationId),
          ),
        );
      if (!scope) {
        throw new NotFoundException(`Versioned approval request ${approvalRequestId} not found`);
      }

      const [definition] = await tx
        .select({ publishedVersionId: workflowDefinitions.publishedVersionId })
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.id, scope.definitionId),
            eq(workflowDefinitions.organizationId, organizationId),
          ),
        )
        .for('update');
      if (!definition?.publishedVersionId) {
        throw new ConflictException('The workflow definition has no published version');
      }

      const latestVersion = await tx.query.workflowDefinitionVersions.findFirst({
        where: (version, { and, eq }) =>
          and(
            eq(version.id, definition.publishedVersionId!),
            eq(version.definitionId, scope.definitionId),
          ),
      });
      if (!latestVersion) {
        throw new ConflictException('The published workflow version is unavailable');
      }
      const executable = executableDefinitionSchema.parse(latestVersion.executableJson);

      await tx
        .update(approvalRequests)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(approvalRequests.id, request.id));

      const [replacement] = await tx
        .insert(approvalRequests)
        .values({
          approvableType: request.approvableType,
          approvableId: request.approvableId,
          approvalRuleId: null,
          definitionVersionId: latestVersion.id,
          currentNodeId: executable.entryStepId,
          attempt: request.attempt + 1,
          currentStep: 1,
          status: 'pending',
          requiredApproverId: null,
          requiredApprovalStep: null,
          requiredApprovalReason: null,
          requiredApprovalKey: null,
        })
        .returning();

      await tx.insert(approvalActions).values({
        approvalRequestId: request.id,
        stepOrder: request.currentStep,
        approverId: userId,
        action: 'cancelled',
        comment: `Restarted as ${replacement.id} on workflow version ${latestVersion.version}`,
      });
      await tx.insert(approvalActions).values({
        approvalRequestId: replacement.id,
        stepOrder: 1,
        approverId: userId,
        action: 'restarted',
        comment: `Restarted from ${request.id} on workflow version ${latestVersion.version}`,
      });
      return {
        cancelledRequestId: request.id,
        replacementRequestId: replacement.id,
        definitionVersionId: latestVersion.id,
        version: latestVersion.version,
        attempt: replacement.attempt,
      };
    });

    this.audit
      .log(
        organizationId,
        userId,
        'approval_request',
        approvalRequestId,
        'restarted_on_latest',
        restarted,
      )
      .catch(() => {});
    return restarted;
  }

  private assertDraftDomain(domain: WorkflowDomain, draft: WorkflowDraft): void {
    if (draft.graph.domain !== domain) {
      throw new BadRequestException(
        `Workflow draft domain ${draft.graph.domain} does not match definition domain ${domain}`,
      );
    }
  }
}
