import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { artifactNotificationDeliveries, artifactOperations } from '@betterspend/db';

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
  /**
   * Deliver the operation's notification before the operation is marked
   * complete. A failure leaves the durable operation retryable, so a
   * notification cannot be lost after a successful artifact write.
   */
  notify?: (value: TResult, delivery: ArtifactDeliveryContext) => Promise<void>;
  /** Load the original result after a completed operation without mutating anything. */
  load: (artifact: ArtifactReference) => Promise<TResult>;
}

export interface ArtifactDeliveryContext {
  /**
   * Run one stable recipient/action delivery after reserving it. The callback
   * receives a deterministic downstream identity that remains unchanged when
   * persistence of the delivered state fails and the operation retries.
   */
  once(deliveryKey: string, deliver: (identity: string) => Promise<unknown>): Promise<void>;
}

export interface ArtifactOperationResult<TResult> {
  value: TResult;
  /** True only when this invocation loaded a fully completed operation. */
  replayed: boolean;
  /** True when this invocation resumed a prior pending, failed, or artifact-created attempt. */
  resumed: boolean;
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

  /** Read-only compatibility probe for callers migrating pre-coordinator state. */
  async operationExists(organizationId: string, idempotencyKey: string): Promise<boolean> {
    const [operation] = await this.db
      .select({ id: artifactOperations.id })
      .from(artifactOperations)
      .where(
        and(
          eq(artifactOperations.organizationId, organizationId),
          eq(artifactOperations.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return Boolean(operation);
  }

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
      return { value, replayed: true, resumed: false };
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
    try {
      if (!artifact) {
        artifact = await plan.findExisting(ownerIdempotencyKey);
        if (artifact) {
          await this.recordArtifact(operation, claim.leaseToken, artifact);
        }
      }
      if (!artifact) {
        artifact = await plan.create(ownerIdempotencyKey);
        await this.recordArtifact(operation, claim.leaseToken, artifact);
      }

      const value = await plan.link(artifact);
      if (plan.notify) {
        await plan.notify(value, {
          once: (deliveryKey, deliver) =>
            this.deliverOnce(operation.organizationId, operation.id, deliveryKey, deliver),
        });
      }
      await this.complete(operation, claim.leaseToken, artifact);
      return { value, replayed: false, resumed: claim.resumed };
    } catch (error) {
      await this.markFailed(operation, claim.leaseToken, artifact, error);
      throw error;
    }
  }

  private async deliverOnce(
    organizationId: string,
    operationId: string,
    rawDeliveryKey: string,
    deliver: (identity: string) => Promise<unknown>,
  ): Promise<void> {
    const deliveryKey = rawDeliveryKey.trim();
    if (!deliveryKey || deliveryKey.length > 255) {
      throw new ConflictException(
        'A non-empty notification delivery key of at most 255 characters is required',
      );
    }

    const now = new Date();
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
    const claim = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(artifactNotificationDeliveries)
        .values({ organizationId, operationId, deliveryKey })
        .onConflictDoNothing({
          target: [
            artifactNotificationDeliveries.operationId,
            artifactNotificationDeliveries.deliveryKey,
          ],
        })
        .returning();
      const row =
        inserted ??
        (
          await tx
            .select()
            .from(artifactNotificationDeliveries)
            .where(
              and(
                eq(artifactNotificationDeliveries.organizationId, organizationId),
                eq(artifactNotificationDeliveries.operationId, operationId),
                eq(artifactNotificationDeliveries.deliveryKey, deliveryKey),
              ),
            )
            .limit(1)
        )[0];
      if (!row) throw new Error('Artifact notification delivery reservation was not found');
      if (row.status === 'delivered') return null;

      const [claimed] = await tx
        .update(artifactNotificationDeliveries)
        .set({
          status: 'pending',
          attempts: sql`${artifactNotificationDeliveries.attempts} + 1`,
          lastError: null,
          leaseToken,
          leaseExpiresAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(artifactNotificationDeliveries.id, row.id),
            ne(artifactNotificationDeliveries.status, 'delivered'),
            or(
              isNull(artifactNotificationDeliveries.leaseExpiresAt),
              lt(artifactNotificationDeliveries.leaseExpiresAt, now),
            ),
          ),
        )
        .returning();
      if (!claimed) {
        throw new ConflictException(
          'This notification delivery is already in progress; retry later',
        );
      }
      return claimed;
    });
    if (!claim) return;

    try {
      await deliver(deliveryIdentity(operationId, deliveryKey));
      const [delivered] = await this.db
        .update(artifactNotificationDeliveries)
        .set({
          status: 'delivered',
          deliveredAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(artifactNotificationDeliveries.id, claim.id),
            eq(artifactNotificationDeliveries.organizationId, organizationId),
            eq(artifactNotificationDeliveries.leaseToken, leaseToken),
          ),
        )
        .returning({ id: artifactNotificationDeliveries.id });
      if (!delivered) throw new ConflictException('Notification delivery lease was lost');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db
        .update(artifactNotificationDeliveries)
        .set({
          status: 'failed',
          lastError: message.slice(0, 10_000),
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(artifactNotificationDeliveries.id, claim.id),
            eq(artifactNotificationDeliveries.organizationId, organizationId),
            eq(artifactNotificationDeliveries.leaseToken, leaseToken),
          ),
        );
      throw error;
    }
  }

  private async claim(
    organizationId: string,
    operationType: ArtifactOperationType,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<{
    operation: OperationRow;
    leaseToken: string;
    completed: boolean;
    resumed: boolean;
  }> {
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
        .onConflictDoNothing({
          target: [artifactOperations.organizationId, artifactOperations.idempotencyKey],
        })
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
        return { operation, leaseToken, completed: true, resumed: false };
      }

      const resumed = operation.attempts > 0 || operation.artifactId !== null;

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
      return { operation: claimed, leaseToken, completed: false, resumed };
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

function deliveryIdentity(operationId: string, deliveryKey: string): string {
  return `artifact-${createHash('sha256').update(`${operationId}:${deliveryKey}`).digest('hex')}@betterspend.local`;
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
