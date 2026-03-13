import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { emailIntakeItems } from '@betterspend/db';
import { NotificationsService } from '../notifications/notifications.service';

export interface CreateEmailIntakeInput {
  sourceEmail: string;
  subject: string;
  body: string;
}

@Injectable()
export class EmailIntakeService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly notificationsService: NotificationsService,
  ) {}

  async list(organizationId: string) {
    return this.db.query.emailIntakeItems.findMany({
      where: (item, { eq }) => eq(item.organizationId, organizationId),
      orderBy: (item, { desc }) => desc(item.createdAt),
      limit: 100,
    });
  }

  async findOne(id: string, organizationId: string) {
    const item = await this.db.query.emailIntakeItems.findFirst({
      where: (record, { and, eq }) => and(eq(record.id, id), eq(record.organizationId, organizationId)),
    });
    if (!item) throw new NotFoundException(`Email intake item ${id} not found`);
    return item;
  }

  async create(organizationId: string, input: CreateEmailIntakeInput) {
    const body = input.body.trim();
    const subject = input.subject.trim();
    const detectedType =
      /invoice|bill|payment/i.test(`${subject}\n${body}`)
        ? 'invoice'
        : /quote|pricing|buy|purchase|request|need/i.test(`${subject}\n${body}`)
          ? 'requisition'
          : 'triage';
    const totalMatch = body.match(/\$?\s?(\d+(?:,\d{3})*(?:\.\d{2})?)/);
    const vendorMatch = body.match(/from\s+([A-Z][A-Za-z0-9&.\- ]{2,})/i);

    const [created] = await this.db
      .insert(emailIntakeItems)
      .values({
        organizationId,
        sourceEmail: input.sourceEmail.trim(),
        subject,
        body,
        detectedType,
        extractedVendorName: vendorMatch?.[1]?.trim() ?? null,
        extractedTotal: totalMatch?.[1]?.replace(/,/g, '') ?? null,
        extractedCurrency: totalMatch ? 'USD' : null,
        rawPayload: {
          source: 'manual_first_pass',
          preview: body.slice(0, 400),
        },
      })
      .returning();

    try {
      const admin = await this.db.query.users.findFirst({
        where: (user, { and, eq }) =>
          and(eq(user.organizationId, organizationId), eq(user.isActive, true)),
        orderBy: (user, { asc }) => asc(user.createdAt),
      });
      if (admin) {
        await this.notificationsService.create(
          organizationId,
          admin.id,
          'email_intake',
          `New ${detectedType} intake received`,
          `${created.sourceEmail} sent "${created.subject}" for review.`,
          'email_intake',
          created.id,
        );
      }
    } catch {
      // Notification failure should not block intake creation.
    }

    return created;
  }

  async discard(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    const [updated] = await this.db
      .update(emailIntakeItems)
      .set({ status: 'discarded', updatedAt: new Date() })
      .where(and(eq(emailIntakeItems.id, id), eq(emailIntakeItems.organizationId, organizationId)))
      .returning();
    return updated;
  }
}
