import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { auditLog, requisitions, rfqRequests, softwareLicenses, vendors } from '@betterspend/db';
import { normalizeMoney, type PermissionKey } from '@betterspend/shared';
import { NotificationsService } from '../notifications/notifications.service';
import { RequisitionsService } from '../requisitions/requisitions.service';
import { RfqService } from '../rfq/rfq.service';
import type { AccessPolicy } from '../auth/access-policy';
import { operationalScope, scopedVendorPredicate } from '../auth/operational-access';
import {
  ArtifactIdempotencyService,
  type ArtifactReference,
} from '../artifact-idempotency/artifact-idempotency.service';

const renewalRefSchema = z.object({
  action: z.enum(['renew', 'renegotiate', 'cancel']),
  kind: z.enum(['requisition', 'rfq']),
  id: z.string(),
  number: z.string(),
  at: z.string(),
});
const renewalRefsSchema = z.array(renewalRefSchema);

export type RenewalRef = z.infer<typeof renewalRefSchema>;

type LicenseWithRelations = Awaited<ReturnType<SoftwareLicensesService['findOne']>>;
type SoftwareLicenseTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class SoftwareLicensesService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly notificationsService: NotificationsService,
    private readonly requisitionsService: RequisitionsService,
    private readonly rfqService: RfqService,
    private readonly artifactIdempotency: ArtifactIdempotencyService,
  ) {}

  async findAll(
    organizationId: string,
    filters?: { status?: string; vendorId?: string; renewingWithinDays?: number },
    access?: AccessPolicy,
  ) {
    const renewalCutoff =
      filters?.renewingWithinDays != null
        ? new Date(Date.now() + filters.renewingWithinDays * 24 * 60 * 60 * 1000)
        : undefined;

    return this.db.query.softwareLicenses.findMany({
      where: (sl, { and, eq, lte }) =>
        and(
          eq(sl.organizationId, organizationId),
          filters?.status ? eq(sl.status, filters.status) : undefined,
          filters?.vendorId ? eq(sl.vendorId, filters.vendorId) : undefined,
          renewalCutoff ? lte(sl.renewalDate, renewalCutoff) : undefined,
          scopedVendorPredicate(
            this.db,
            organizationId,
            access,
            'software_license',
            'software_licenses:view',
            sl.vendorId,
          ),
        ),
      with: {
        vendor: true,
        contract: true,
        owner: true,
      },
      orderBy: (sl, { asc }) => [asc(sl.renewalDate), asc(sl.productName)],
    });
  }

  async findOne(
    id: string,
    organizationId: string,
    access?: AccessPolicy,
    permission: PermissionKey = 'software_licenses:view',
  ) {
    const license = await this.db.query.softwareLicenses.findFirst({
      where: (sl, { and, eq }) =>
        and(
          eq(sl.id, id),
          eq(sl.organizationId, organizationId),
          scopedVendorPredicate(
            this.db,
            organizationId,
            access,
            'software_license',
            permission,
            sl.vendorId,
          ),
        ),
      with: {
        vendor: true,
        contract: true,
        owner: true,
      },
    });

    if (!license) throw new NotFoundException(`Software license ${id} not found`);
    return license;
  }

  async create(data: typeof softwareLicenses.$inferInsert, access?: AccessPolicy) {
    await this.assertVendorScope(
      data.organizationId,
      access,
      'software_licenses:manage',
      data.vendorId,
    );
    const [license] = await this.db.insert(softwareLicenses).values(data).returning();
    await this.notifyIfRenewalDueSoon(license);
    return this.findOne(license.id, data.organizationId, access, 'software_licenses:manage');
  }

  async update(
    id: string,
    organizationId: string,
    data: Partial<typeof softwareLicenses.$inferInsert>,
    access?: AccessPolicy,
  ) {
    const license = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(softwareLicenses)
        .where(
          and(eq(softwareLicenses.id, id), eq(softwareLicenses.organizationId, organizationId)),
        )
        .for('update');
      if (!existing) throw new NotFoundException(`Software license ${id} not found`);

      await this.assertVendorScopeInTransaction(
        tx,
        organizationId,
        access,
        'software_licenses:manage',
        existing.vendorId,
      );
      await this.assertVendorScopeInTransaction(
        tx,
        organizationId,
        access,
        'software_licenses:manage',
        data.vendorId === undefined ? existing.vendorId : data.vendorId,
      );

      const [updated] = await tx
        .update(softwareLicenses)
        .set({ ...data, updatedAt: new Date() })
        .where(
          and(eq(softwareLicenses.id, id), eq(softwareLicenses.organizationId, organizationId)),
        )
        .returning();
      if (!updated) throw new NotFoundException(`Software license ${id} not found`);
      return updated;
    });

    await this.notifyIfRenewalDueSoon(license);
    return this.findOne(id, organizationId, access, 'software_licenses:manage');
  }

  async renewalCalendar(organizationId: string, daysAhead = 90, access?: AccessPolicy) {
    const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    return this.db.query.softwareLicenses.findMany({
      where: (sl, { and, eq, lte }) =>
        and(
          eq(sl.organizationId, organizationId),
          eq(sl.status, 'active'),
          lte(sl.renewalDate, cutoff),
          scopedVendorPredicate(
            this.db,
            organizationId,
            access,
            'software_license',
            'software_licenses:view',
            sl.vendorId,
          ),
        ),
      with: {
        vendor: true,
        owner: true,
      },
      orderBy: (sl, { asc }) => asc(sl.renewalDate),
    });
  }

  async utilization(organizationId: string, access?: AccessPolicy) {
    const scope = operationalScope(access, 'software_license', 'software_licenses:view');
    const vendorScope =
      !scope || scope.unrestricted
        ? sql``
        : scope.entityIds.length > 0
          ? sql`AND v.entity_id IN (${sql.join(
              scope.entityIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : sql`AND false`;
    const rows = await this.db.execute(sql`
      SELECT
        sl.id,
        sl.product_name AS "productName",
        sl.seat_count AS "seatCount",
        sl.seats_used AS "seatsUsed",
        ROUND((sl.seats_used::numeric / NULLIF(sl.seat_count, 0)) * 100, 1) AS "utilizationPct",
        sl.price_per_seat::numeric AS "pricePerSeat",
        sl.currency,
        sl.billing_cycle AS "billingCycle",
        (sl.seat_count * sl.price_per_seat)::numeric AS "contractValue",
        v.name AS "vendorName"
      FROM software_licenses sl
      JOIN vendors v ON v.id = sl.vendor_id AND v.organization_id = ${organizationId}
      WHERE sl.organization_id = ${organizationId}
        AND sl.status IN ('active', 'renewal_due')
        ${vendorScope}
      ORDER BY "utilizationPct" DESC NULLS LAST, sl.product_name ASC
    `);
    return rows;
  }

  async upcomingRenewalCount(organizationId: string, daysAhead = 30, access?: AccessPolicy) {
    const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(softwareLicenses)
      .where(
        and(
          eq(softwareLicenses.organizationId, organizationId),
          eq(softwareLicenses.status, 'active'),
          lte(softwareLicenses.renewalDate, cutoff),
          scopedVendorPredicate(
            this.db,
            organizationId,
            access,
            'software_license',
            'software_licenses:view',
            softwareLicenses.vendorId,
          ),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  async applyRenewalAction(
    id: string,
    organizationId: string,
    userId: string,
    action: 'renew' | 'renegotiate' | 'cancel',
    note?: string,
    access?: AccessPolicy,
  ) {
    const license = await this.findOne(id, organizationId, access, 'software_licenses:manage');
    const actionNote = note?.trim() || undefined;
    if (action === 'cancel') {
      const updatedAt = new Date();
      const notePrefix = `[${updatedAt.toISOString()}] ${action.toUpperCase()}`;
      const appendedNote = [license.notes, `${notePrefix}${actionNote ? `: ${actionNote}` : ''}`]
        .filter(Boolean)
        .join('\n\n');
      await this.db
        .update(softwareLicenses)
        .set({
          autoRenews: false,
          status: 'renewal_due',
          notes: appendedNote,
          updatedAt,
        })
        .where(
          and(eq(softwareLicenses.id, id), eq(softwareLicenses.organizationId, organizationId)),
        );
      await this.notifyRenewalAction(license, organizationId, action, actionNote, null, true);
      return this.findOne(id, organizationId, access, 'software_licenses:manage');
    }

    const operationKey = licenseRenewalOperationKey(license);
    const legacyRef = currentCycleLegacyRenewalRef(license);
    if (
      legacyRef &&
      !(await this.artifactIdempotency.operationExists(organizationId, operationKey))
    ) {
      if (legacyRef.action !== action) {
        throw new ConflictException(
          `A ${legacyRef.action} artifact already exists for this renewal cycle`,
        );
      }
      return this.findOne(id, organizationId, access, 'software_licenses:manage');
    }

    const execution = await this.artifactIdempotency.execute<RenewalRef>({
      organizationId,
      operationType: 'software_license_renewal',
      idempotencyKey: operationKey,
      fingerprint: licenseRenewalFingerprint(license.id, action),
      findExisting: (ownerIdempotencyKey) =>
        this.findRenewalArtifact(organizationId, ownerIdempotencyKey, action),
      create: async (ownerIdempotencyKey) => {
        return action === 'renew'
          ? this.createRenewalRequisition(license, userId, actionNote, ownerIdempotencyKey)
          : this.createRenegotiationRfq(license, userId, actionNote, ownerIdempotencyKey);
      },
      link: (artifact) =>
        this.linkRenewalArtifact({
          id,
          organizationId,
          userId,
          action,
          actionNote,
          artifact,
        }),
      notify: (renewalRef, delivery) =>
        delivery.once(`renewal-action:${license.ownerUserId ?? userId}:${action}`, (identity) =>
          this.notifyRenewalAction(
            license,
            organizationId,
            action,
            actionNote,
            renewalRef,
            true,
            identity,
          ),
        ),
      load: (artifact) => this.loadRenewalRef(id, organizationId, action, artifact, access),
    });
    return this.findOne(id, organizationId, access, 'software_licenses:manage');
  }

  /** Draft a requisition covering the next billing term so the renewal goes through normal approval. */
  private async createRenewalRequisition(
    license: LicenseWithRelations,
    userId: string,
    note: string | undefined,
    ownerIdempotencyKey: string,
  ): Promise<ArtifactReference> {
    const unitPrice = normalizeMoney(license.pricePerSeat);
    const requisition = await this.requisitionsService.create(
      license.organizationId,
      license.ownerUserId ?? userId,
      {
        title: `Software renewal: ${license.productName}`,
        description: [
          `Renewal for ${license.productName} (${license.seatCount} seats, ${license.billingCycle} term).`,
          `Vendor: ${license.vendor?.name ?? license.vendorId}.`,
          note ? `Owner note: ${note}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        currency: license.currency,
        neededBy: license.renewalDate ? new Date(license.renewalDate).toISOString() : undefined,
        priority: 'normal',
        lines: [
          {
            description: `${license.productName} license renewal (${license.billingCycle})`,
            quantity: license.seatCount,
            unitOfMeasure: 'seats',
            unitPrice,
            vendorId: license.vendorId,
          },
        ],
        ownerIdempotencyKey,
      },
    );
    return {
      kind: 'requisition',
      id: requisition.id,
      number: String(requisition.number),
    };
  }

  /** Issue an RFQ to the incumbent vendor so pricing can be challenged before renewal. */
  private async createRenegotiationRfq(
    license: LicenseWithRelations,
    userId: string,
    note: string | undefined,
    ownerIdempotencyKey: string,
  ): Promise<ArtifactReference> {
    const targetPrice = normalizeMoney(license.pricePerSeat);
    const requestedDueDate = license.renewalDate
      ? new Date(license.renewalDate).getTime() - 7 * 24 * 60 * 60 * 1000
      : 0;
    const minimumDueDate = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const rfq = await this.rfqService.createInternal(
      license.organizationId,
      userId,
      {
        title: `Renegotiation: ${license.productName} renewal`,
        description: `Competing quotes requested ahead of the ${license.renewalDate ? new Date(license.renewalDate).toLocaleDateString() : 'upcoming'} renewal of ${license.productName}. Current rate is ${license.currency} ${targetPrice} per seat.`,
        notes: note,
        currency: license.currency,
        dueDate: new Date(Math.max(requestedDueDate, minimumDueDate)).toISOString(),
        lines: [
          {
            description: `${license.productName} (${license.seatCount} seats, ${license.billingCycle})`,
            quantity: license.seatCount,
            unitOfMeasure: 'seats',
            targetPrice,
          },
        ],
        vendorIds: [license.vendorId],
      },
      ownerIdempotencyKey,
    );
    return {
      kind: 'rfq',
      id: rfq.id,
      number: String(rfq.number),
    };
  }

  private async findRenewalArtifact(
    organizationId: string,
    ownerIdempotencyKey: string,
    action: 'renew' | 'renegotiate',
  ): Promise<ArtifactReference | null> {
    if (action === 'renew') {
      const [requisition] = await this.db
        .select({ id: requisitions.id, number: requisitions.number })
        .from(requisitions)
        .where(
          and(
            eq(requisitions.organizationId, organizationId),
            eq(requisitions.idempotencyKey, ownerIdempotencyKey),
          ),
        )
        .limit(1);
      if (!requisition) return null;
      await this.requisitionsService.ensureSpendGuardAnalysis(organizationId, requisition.id);
      return { kind: 'requisition', id: requisition.id, number: requisition.number };
    }

    const [rfq] = await this.db
      .select({ id: rfqRequests.id, number: rfqRequests.number })
      .from(rfqRequests)
      .where(
        and(
          eq(rfqRequests.organizationId, organizationId),
          eq(rfqRequests.idempotencyKey, ownerIdempotencyKey),
        ),
      )
      .limit(1);
    return rfq ? { kind: 'rfq', id: rfq.id, number: rfq.number } : null;
  }

  private async linkRenewalArtifact(input: {
    id: string;
    organizationId: string;
    userId: string;
    action: 'renew' | 'renegotiate';
    actionNote?: string;
    artifact: ArtifactReference;
  }): Promise<RenewalRef> {
    const expectedKind = input.action === 'renew' ? 'requisition' : 'rfq';
    if (input.artifact.kind !== expectedKind) {
      throw new ConflictException('The artifact kind does not match the renewal operation');
    }

    // Artifact owner modules have their own transactions. Resume a lifecycle
    // transition that completed before license linkage failed.
    if (input.action === 'renew') {
      await this.requisitionsService.ensureSpendGuardAnalysis(
        input.organizationId,
        input.artifact.id,
      );
      const requisition = await this.requisitionsService.findOne(
        input.artifact.id,
        input.organizationId,
      );
      if (requisition.status === 'draft') {
        await this.requisitionsService.submit(input.artifact.id, input.organizationId);
      }
    } else {
      const rfq = await this.rfqService.findOne(input.organizationId, input.artifact.id);
      if (rfq.status === 'draft') {
        await this.rfqService.open(input.organizationId, input.artifact.id, input.userId);
      }
    }

    const renewalRef: RenewalRef = {
      action: input.action,
      kind: expectedKind,
      id: input.artifact.id,
      number: String(input.artifact.number ?? input.artifact.id),
      at: new Date().toISOString(),
    };

    return this.db.transaction(async (tx) => {
      const [license] = await tx
        .select({
          notes: softwareLicenses.notes,
          renewalRefs: softwareLicenses.renewalRefs,
        })
        .from(softwareLicenses)
        .where(
          and(
            eq(softwareLicenses.id, input.id),
            eq(softwareLicenses.organizationId, input.organizationId),
          ),
        )
        .for('update');
      if (!license) throw new NotFoundException(`Software license ${input.id} not found`);

      const refs = renewalRefsSchema.parse(license.renewalRefs);
      const existing = refs.find((reference) => reference.id === renewalRef.id);
      if (existing) return existing;

      const updatedAt = new Date();
      const notePrefix = `[${updatedAt.toISOString()}] ${input.action.toUpperCase()}`;
      const appendedNote = [
        license.notes,
        `${notePrefix}${input.actionNote ? `: ${input.actionNote}` : ''}`,
      ]
        .filter(Boolean)
        .join('\n\n');
      const [updated] = await tx
        .update(softwareLicenses)
        .set({
          status: 'renewal_due',
          notes: appendedNote,
          renewalRefs: sql`COALESCE(${softwareLicenses.renewalRefs}, '[]'::jsonb) || ${JSON.stringify([renewalRef])}::jsonb`,
          updatedAt,
        })
        .where(
          and(
            eq(softwareLicenses.id, input.id),
            eq(softwareLicenses.organizationId, input.organizationId),
          ),
        )
        .returning({ id: softwareLicenses.id });
      if (!updated) throw new NotFoundException(`Software license ${input.id} not found`);
      await tx.insert(auditLog).values({
        organizationId: input.organizationId,
        userId: input.userId,
        entityType: 'software_license',
        entityId: input.id,
        action: `${input.action}_renewal_artifact_linked`,
        changes: {
          artifactKind: renewalRef.kind,
          artifactId: renewalRef.id,
          artifactNumber: renewalRef.number,
          status: 'renewal_due',
        },
      });
      return renewalRef;
    });
  }

  private async loadRenewalRef(
    id: string,
    organizationId: string,
    action: 'renew' | 'renegotiate',
    artifact: ArtifactReference,
    access?: AccessPolicy,
  ): Promise<RenewalRef> {
    const license = await this.findOne(id, organizationId, access, 'software_licenses:manage');
    const existing = renewalRefsSchema
      .parse(license.renewalRefs)
      .find((reference) => reference.id === artifact.id && reference.action === action);
    if (!existing) {
      throw new ConflictException(
        'The artifact operation is complete but its license link is missing',
      );
    }
    return existing;
  }

  private async notifyRenewalAction(
    license: LicenseWithRelations,
    organizationId: string,
    action: 'renew' | 'renegotiate' | 'cancel',
    actionNote: string | undefined,
    renewalRef: RenewalRef | null,
    shouldNotify: boolean,
    idempotencyKey?: string,
  ): Promise<void> {
    if (!shouldNotify || !license.ownerUserId) return;

    const refSuffix = renewalRef ? ` Tracked as ${renewalRef.number}.` : '';
    const actionTitle =
      action === 'renew'
        ? `${license.productName} renewal requisition created`
        : action === 'cancel'
          ? `${license.productName} marked for cancellation review`
          : `${license.productName} renegotiation RFQ created`;
    const actionBody =
      action === 'renew'
        ? `A renewal requisition for ${license.productName} was drafted and routed for approval.${refSuffix}`
        : action === 'cancel'
          ? `${license.productName} auto-renew has been disabled and cancellation review is in progress.`
          : `An RFQ was issued to gather competing quotes before renewing ${license.productName}.${refSuffix}`;
    const args = [
      organizationId,
      license.ownerUserId,
      'software_license_renewal_action',
      actionTitle,
      actionNote ? `${actionBody} Note: ${actionNote}` : actionBody,
      'software_license',
      license.id,
    ] as const;
    if (idempotencyKey) {
      await this.notificationsService.createIdempotent(idempotencyKey, ...args);
    } else {
      await this.notificationsService.create(...args);
    }
  }

  private async notifyIfRenewalDueSoon(license: typeof softwareLicenses.$inferSelect) {
    if (!license.ownerUserId || !license.renewalDate) return;

    const daysUntilRenewal = Math.ceil(
      (new Date(license.renewalDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );

    if (daysUntilRenewal > license.renewalLeadDays) return;

    await this.notificationsService.create(
      license.organizationId,
      license.ownerUserId,
      'software_license_renewal',
      `${license.productName} renewal is approaching`,
      `${license.productName} renews in ${Math.max(daysUntilRenewal, 0)} day(s). Review seat usage before renewal.`,
      'software_license',
      license.id,
    );

    if (daysUntilRenewal >= 0 && license.status === 'active') {
      await this.db
        .update(softwareLicenses)
        .set({ status: 'renewal_due', updatedAt: new Date() })
        .where(eq(softwareLicenses.id, license.id));
    }
  }

  private async assertVendorScope(
    organizationId: string,
    access: AccessPolicy | undefined,
    permission: PermissionKey,
    vendorId: string | null | undefined,
  ) {
    if (!vendorId) {
      const scope = operationalScope(access, 'software_license', permission);
      if (scope && !scope.unrestricted) {
        throw new ForbiddenException('The software license vendor is outside your assigned scope');
      }
      return;
    }

    const [vendor] = await this.db
      .select({ id: vendors.id, entityId: vendors.entityId })
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)));
    if (!vendor) {
      throw new ForbiddenException(
        'The software license vendor must belong to the current organization',
      );
    }

    const scope = operationalScope(access, 'software_license', permission);
    if (scope && !scope.unrestricted && !scope.entityIds.includes(vendor.entityId ?? '')) {
      throw new ForbiddenException('The software license vendor is outside your assigned scope');
    }
  }

  private async assertVendorScopeInTransaction(
    tx: SoftwareLicenseTransaction,
    organizationId: string,
    access: AccessPolicy | undefined,
    permission: PermissionKey,
    vendorId: string | null | undefined,
  ) {
    const scope = operationalScope(access, 'software_license', permission);
    if (!vendorId) {
      if (scope && !scope.unrestricted) {
        throw new ForbiddenException('The software license vendor is outside your assigned scope');
      }
      return;
    }

    const [vendor] = await tx
      .select({ id: vendors.id, entityId: vendors.entityId })
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)))
      .for('share');
    if (!vendor) {
      throw new ForbiddenException(
        'The software license vendor must belong to the current organization',
      );
    }
    if (scope && !scope.unrestricted && !scope.entityIds.includes(vendor.entityId ?? '')) {
      throw new ForbiddenException('The software license vendor is outside your assigned scope');
    }
  }
}

function licenseRenewalOperationKey(license: LicenseWithRelations): string {
  const renewalCycle = license.renewalDate?.toISOString() ?? 'unscheduled';
  return `license-renewal:${license.id}:${renewalCycle}`;
}

function currentCycleLegacyRenewalRef(license: LicenseWithRelations): RenewalRef | undefined {
  const renewalDate = license.renewalDate ? new Date(license.renewalDate) : null;
  if (!renewalDate) return undefined;
  const cycleStart = previousRenewalPeriodStart(
    renewalDate,
    license.billingCycle === 'monthly' ? 'monthly' : 'annual',
  );

  return renewalRefsSchema
    .parse(license.renewalRefs)
    .filter((reference) => reference.action !== 'cancel')
    .find((reference) => {
      const createdAt = new Date(reference.at);
      return !Number.isNaN(createdAt.getTime()) && createdAt >= cycleStart;
    });
}

export function previousRenewalPeriodStart(
  renewalDate: Date,
  billingCycle: 'monthly' | 'annual',
): Date {
  const targetYear = renewalDate.getUTCFullYear() - (billingCycle === 'annual' ? 1 : 0);
  const targetMonth = renewalDate.getUTCMonth() - (billingCycle === 'monthly' ? 1 : 0);
  const firstOfTargetMonth = new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      1,
      renewalDate.getUTCHours(),
      renewalDate.getUTCMinutes(),
      renewalDate.getUTCSeconds(),
      renewalDate.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(firstOfTargetMonth.getUTCFullYear(), firstOfTargetMonth.getUTCMonth() + 1, 0),
  ).getUTCDate();
  firstOfTargetMonth.setUTCDate(Math.min(renewalDate.getUTCDate(), lastDay));
  return firstOfTargetMonth;
}

export function licenseRenewalFingerprint(
  licenseId: string,
  action: 'renew' | 'renegotiate',
): string {
  return JSON.stringify({
    licenseId,
    action,
  });
}
