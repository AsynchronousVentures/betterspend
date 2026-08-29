import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { artifactOperations } from '@betterspend/db';

export const ARTIFACT_OPERATION_TYPES = ['software_license_renewal', 'message_post'] as const;
export type ArtifactOperationType = (typeof ARTIFACT_OPERATION_TYPES)[number];

export const ARTIFACT_KINDS = ['requisition', 'rfq', 'message'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface ArtifactReference {
  kind: ArtifactKind;
  id: string;
  number?: string | null;
}

export interface ArtifactOperationPlan<TResult> {
  organizationId: string;
  operationType: ArtifactOperationType;
  idempotencyKey: string;
  /** A stable description of the requested write, never raw secrets or message bodies. */
  fingerprint: string;
  /**
   * Find an owner artifact by its private operation key after a partial failure.
   * The coordinator supplies the key after reserving the operation, so callers
   * cannot accidentally collide with an unrelated public idempotency key.
   */
  findExisting: (ownerIdempotencyKey: string) => Promise<ArtifactReference | null>;
  /**
   * Create only the artifact with the private operation key. Linkage and later
   * lifecycle transitions belong in `link`.
   */
  create: (ownerIdempotencyKey: string) => Promise<ArtifactReference>;
  /** Complete the caller-side linkage. This callback must be safe to repeat. */
  link: (artifact: ArtifactReference) => Promise<TResult>;
  /** Load the original result after a completed operation without mutating anything. */
  load: (artifact: ArtifactReference) => Promise<TResult>;
}

export interface ArtifactOperationResult<TResult> {
  value: TResult;
  /** True when this invocation resumed or returned an existing operation. */
  replayed: boolean;
}

type OperationRow = typeof artifactOperations.$inferSelect;

const LEASE_DURATION_MS = 15 * 60 * 1000;

/**
 * Coordinates a small set of cross-module writes whose artifact owner and
 * caller-side linkage cannot share one database transaction. The operation
 * row is the durable state machine; owner tables retain the key for recovery
 * when an owner transaction commits before the state row advances.
 */
@Injectable()
export class ArtifactIdempotencyService {
  private readonly logger = new Logger(ArtifactIdempotencyService.name);

  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  /**
   * Run an artifact operation through the durable reserve/create/link flow.
   * Callers must supply an idempotent `link` implementation because this seam
   * intentionally spans separate transactions owned by other modules.
   */
  async execute<TResult>(
    plan: ArtifactOperationPlan<TResult>,
  ): Promise<ArtifactOperationResult<TResult>> {
    const idempotencyKey = plan.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new ConflictException(
        'A non-empty idempotency key of at most 255 characters is required',
      );
    }
    const requestHash = hashFingerprint(plan.fingerprint);
    const claim = await this.claim(
      plan.organizationId,
      plan.operationType,
      idempotencyKey,
      requestHash,
    );

    if (claim.completed) {
      if (!claim.operation.artifactId || !claim.operation.artifactKind) {
        throw new Error('Completed artifact operation has no artifact reference');
      }
      const value = await plan.load({
        kind: assertArtifactKind(claim.operation.artifactKind),
        id: claim.operation.artifactId,
        number: claim.operation.artifactNumber,
      });
      return { value, replayed: true };
    }

    const operation = claim.operation;
    const ownerIdempotencyKey = `artifact-operation:${operation.id}`;
    let artifact: ArtifactReference | null = operation.artifactId
      ? {
          kind: assertArtifactKind(operation.artifactKind),
          id: operation.artifactId,
          number: operation.artifactNumber,
        }
      : null;
    const hadExistingArtifact = artifact !== null;
    let recoveredExistingArtifact = false;

    try {
      if (!artifact) {
        artifact = await plan.findExisting(ownerIdempotencyKey);
        if (artifact) {
          recoveredExistingArtifact = true;
          await this.recordArtifact(operation, claim.leaseToken, artifact);
        }
      }
      if (!artifact) {
        artifact = await plan.create(ownerIdempotencyKey);
        await this.recordArtifact(operation, claim.leaseToken, artifact);
      }

      const value = await plan.link(artifact);
      await this.complete(operation, claim.leaseToken, artifact);
      return { value, replayed: hadExistingArtifact || recoveredExistingArtifact };
    } catch (error) {
      await this.markFailed(operation, claim.leaseToken, artifact, error);
      throw error;
    }
  }

  private async claim(
    organizationId: string,
    operationType: ArtifactOperationType,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<{ operation: OperationRow; leaseToken: string; completed: boolean }> {
    const now = new Date();
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);

    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(artifactOperations)
        .values({
          organizationId,
          operationType,
          idempotencyKey,
          requestHash,
        })
        .onConflictDoNothing()
        .returning();
      const operation =
        inserted ??
        (
          await tx
            .select()
            .from(artifactOperations)
            .where(
              and(
                eq(artifactOperations.organizationId, organizationId),
                eq(artifactOperations.idempotencyKey, idempotencyKey),
              ),
            )
            .limit(1)
        )[0];
      if (!operation) throw new Error('Artifact operation reservation was not found');
      if (operation.operationType !== operationType || operation.requestHash !== requestHash) {
        throw new ConflictException('The idempotency key was reused for a different operation');
      }
      if (operation.status === 'completed') {
        return { operation, leaseToken, completed: true };
      }

      const [claimed] = await tx
        .update(artifactOperations)
        .set({
          status: operation.artifactId ? 'artifact_created' : 'pending',
          attempts: sql`${artifactOperations.attempts} + 1`,
          lastError: null,
          leaseToken,
          leaseExpiresAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(artifactOperations.id, operation.id),
            ne(artifactOperations.status, 'completed'),
            or(
              isNull(artifactOperations.leaseExpiresAt),
              lt(artifactOperations.leaseExpiresAt, now),
            ),
          ),
        )
        .returning();
      if (!claimed) {
        throw new ConflictException('This artifact operation is already in progress; retry later');
      }
      return { operation: claimed, leaseToken, completed: false };
    });
  }

  private async recordArtifact(
    operation: OperationRow,
    leaseToken: string,
    artifact: ArtifactReference,
  ): Promise<void> {
    assertArtifactKind(artifact.kind);
    const [updated] = await this.db
      .update(artifactOperations)
      .set({
        status: 'artifact_created',
        artifactKind: artifact.kind,
        artifactId: artifact.id,
        artifactNumber: artifact.number ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(artifactOperations.id, operation.id), eq(artifactOperations.leaseToken, leaseToken)),
      )
      .returning({ id: artifactOperations.id });
    if (!updated) throw new ConflictException('Artifact operation lease was lost before linkage');
  }

  private async complete(
    operation: OperationRow,
    leaseToken: string,
    artifact: ArtifactReference,
  ): Promise<void> {
    const [updated] = await this.db
      .update(artifactOperations)
      .set({
        status: 'completed',
        artifactKind: artifact.kind,
        artifactId: artifact.id,
        artifactNumber: artifact.number ?? null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(artifactOperations.id, operation.id), eq(artifactOperations.leaseToken, leaseToken)),
      )
      .returning({ id: artifactOperations.id });
    if (!updated) throw new ConflictException('Artifact operation lease was lost after linkage');
  }

  private async markFailed(
    operation: OperationRow,
    leaseToken: string,
    artifact: ArtifactReference | null,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await this.db
        .update(artifactOperations)
        .set({
          status: 'failed',
          artifactKind: artifact?.kind ?? null,
          artifactId: artifact?.id ?? null,
          artifactNumber: artifact?.number ?? null,
          lastError: message.slice(0, 10_000),
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(artifactOperations.id, operation.id),
            eq(artifactOperations.leaseToken, leaseToken),
          ),
        );
    } catch (markError) {
      this.logger.error(
        `Could not persist artifact operation failure ${operation.id}: ${markError instanceof Error ? markError.message : markError}`,
      );
    }
  }
}

function hashFingerprint(fingerprint: string): string {
  return createHash('sha256').update(fingerprint).digest('hex');
}

function assertArtifactKind(value: string | null): ArtifactKind {
  if (!(ARTIFACT_KINDS as readonly string[]).includes(value ?? '')) {
    throw new Error(`Unsupported artifact kind "${value ?? ''}"`);
  }
  return value as ArtifactKind;
}
