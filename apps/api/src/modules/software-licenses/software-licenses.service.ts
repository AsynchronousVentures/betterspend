import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { softwareLicenses } from '@betterspend/db';
import { NotificationsService } from '../notifications/notifications.service';
import { RequisitionsService } from '../requisitions/requisitions.service';
import { RfqService } from '../rfq/rfq.service';

export interface RenewalRef {
  action: 'renew' | 'renegotiate' | 'cancel';
  kind: 'requisition' | 'rfq';
  id: string;
  number: string;
  at: string;
}

type LicenseWithRelations = Awaited<ReturnType<SoftwareLicensesService['findOne']>>;

@Injectable()
export class SoftwareLicensesService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly notificationsService: NotificationsService,
    private readonly requisitionsService: RequisitionsService,
    private readonly rfqService: RfqService,
  ) {}

  async findAll(
    organizationId: string,
    filters?: { status?: string; vendorId?: string; renewingWithinDays?: number },
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
        ),
      with: {
        vendor: true,
        contract: true,
        owner: true,
      },
      orderBy: (sl, { asc }) => [asc(sl.renewalDate), asc(sl.productName)],
    });
  }

  async findOne(id: string, organizationId: string) {
    const license = await this.db.query.softwareLicenses.findFirst({
      where: (sl, { and, eq }) => and(eq(sl.id, id), eq(sl.organizationId, organizationId)),
      with: {
        vendor: true,
        contract: true,
        owner: true,
      },
    });

    if (!license) throw new NotFoundException(`Software license ${id} not found`);
    return license;
  }

  async create(data: typeof softwareLicenses.$inferInsert) {
    const [license] = await this.db.insert(softwareLicenses).values(data).returning();
    await this.notifyIfRenewalDueSoon(license);
    return this.findOne(license.id, data.organizationId);
  }

  async update(
    id: string,
    organizationId: string,
    data: Partial<typeof softwareLicenses.$inferInsert>,
  ) {
    await this.findOne(id, organizationId);

    const [license] = await this.db
      .update(softwareLicenses)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(softwareLicenses.id, id), eq(softwareLicenses.organizationId, organizationId)))
      .returning();

    if (!license) throw new NotFoundException(`Software license ${id} not found`);
    await this.notifyIfRenewalDueSoon(license);
    return this.findOne(id, organizationId);
  }

  async renewalCalendar(organizationId: string, daysAhead = 90) {
    const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    return this.db.query.softwareLicenses.findMany({
      where: (sl, { and, eq, lte }) =>
        and(
          eq(sl.organizationId, organizationId),
          eq(sl.status, 'active'),
          lte(sl.renewalDate, cutoff),
        ),
      with: {
        vendor: true,
        owner: true,
      },
      orderBy: (sl, { asc }) => asc(sl.renewalDate),
    });
  }

  async utilization(organizationId: string) {
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
      JOIN vendors v ON v.id = sl.vendor_id
      WHERE sl.organization_id = ${organizationId}
        AND sl.status IN ('active', 'renewal_due')
      ORDER BY "utilizationPct" DESC NULLS LAST, sl.product_name ASC
    `);
    return rows;
  }

  async upcomingRenewalCount(organizationId: string, daysAhead = 30) {
    const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(softwareLicenses)
      .where(
        and(
          eq(softwareLicenses.organizationId, organizationId),
          eq(softwareLicenses.status, 'active'),
          lte(softwareLicenses.renewalDate, cutoff),
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
  ) {
    const license = await this.findOne(id, organizationId);
    const actionNote = note?.trim();
    const notePrefix = `[${new Date().toISOString()}] ${action.toUpperCase()}`;
    const appendedNote = [license.notes, `${notePrefix}${actionNote ? `: ${actionNote}` : ''}`]
      .filter(Boolean)
      .join('\n\n');

    const updates: Partial<typeof softwareLicenses.$inferInsert> & { updatedAt: Date } = {
      updatedAt: new Date(),
      notes: appendedNote,
    };

    let renewalRef: RenewalRef | null = null;

    if (action === 'renew') {
      // Creating a requisition starts the procurement process; it does not
      // prove that the renewal was approved or purchased. Keep the current
      // renewal date and due status until the approved procurement outcome
      // is explicitly linked back to this license.
      updates.status = 'renewal_due';
      renewalRef = await this.createRenewalRequisition(license, userId, actionNote);
    } else if (action === 'renegotiate') {
      updates.status = 'renewal_due';
      renewalRef = await this.createRenegotiationRfq(license, userId, actionNote);
    } else {
      updates.autoRenews = false;
      updates.status = 'renewal_due';
    }

    if (renewalRef) {
      // Append atomically in SQL so concurrent actions cannot overwrite each
      // other's reference via a stale in-memory snapshot.
      updates.renewalRefs =
        sql`COALESCE(${softwareLicenses.renewalRefs}, '[]'::jsonb) || ${JSON.stringify([renewalRef])}::jsonb` as unknown as RenewalRef[];
    }

    await this.db
      .update(softwareLicenses)
      .set(updates)
      .where(and(eq(softwareLicenses.id, id), eq(softwareLicenses.organizationId, organizationId)));

    if (license.ownerUserId) {
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
      await this.notificationsService.create(
        organizationId,
        license.ownerUserId,
        'software_license_renewal_action',
        actionTitle,
        actionNote ? `${actionBody} Note: ${actionNote}` : actionBody,
        'software_license',
        license.id,
      );
    }

    return this.findOne(id, organizationId);
  }

  /** Draft a requisition covering the next billing term so the renewal goes through normal approval. */
  private async createRenewalRequisition(
    license: LicenseWithRelations,
    userId: string,
    note?: string,
  ): Promise<RenewalRef> {
    const unitPrice = Number(license.pricePerSeat);
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
      },
    );
    // Submit so the renewal actually routes through the approval engine; a
    // draft would sit untouched while the notification claims otherwise.
    await this.requisitionsService.submit(requisition.id, license.organizationId);
    return {
      action: 'renew',
      kind: 'requisition',
      id: requisition.id,
      number: String(requisition.number),
      at: new Date().toISOString(),
    };
  }

  /** Issue an RFQ to the incumbent vendor so pricing can be challenged before renewal. */
  private async createRenegotiationRfq(
    license: LicenseWithRelations,
    userId: string,
    note?: string,
  ): Promise<RenewalRef> {
    const targetPrice = Number(license.pricePerSeat);
    const requestedDueDate = license.renewalDate
      ? new Date(license.renewalDate).getTime() - 7 * 24 * 60 * 60 * 1000
      : 0;
    const minimumDueDate = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const rfq = await this.rfqService.create(license.organizationId, userId, {
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
    });
    // Vendors can only respond to open RFQs; a renegotiation RFQ is issued to
    // be answered, so move it out of draft immediately.
    await this.rfqService.open(license.organizationId, rfq.id);
    return {
      action: 'renegotiate',
      kind: 'rfq',
      id: rfq.id,
      number: String(rfq.number),
      at: new Date().toISOString(),
    };
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
}
