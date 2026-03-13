import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { softwareLicenses } from '@betterspend/db';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SoftwareLicensesService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly notificationsService: NotificationsService,
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
