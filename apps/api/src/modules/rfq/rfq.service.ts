import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import { SequenceService } from '../../common/services/sequence.service';
import type { Db } from '@betterspend/db';
import {
  appendAuditLog,
  rfqRequests,
  rfqLines,
  rfqInvitations,
  rfqResponses,
  rfqResponseLines,
  vendors,
  users,
  sequences,
  purchaseOrders,
  poLines,
} from '@betterspend/db';
import { normalizeMoney } from '@betterspend/shared';
import { MailService } from '../../common/mail/mail.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class RfqService {
  constructor(
    @Inject(DB_TOKEN) private db: Db,
    private readonly sequenceService: SequenceService,
    private readonly mailService: MailService,
    private readonly settingsService: SettingsService,
  ) {}

  private async sendDecisionEmail(
    orgId: string,
    params: {
      vendorId: string;
      rfqNumber: string;
      rfqTitle?: string | null;
      status: 'accepted' | 'rejected';
      reason?: string;
      purchaseOrderNumber?: string;
    },
  ) {
    const vendor = await this.db.query.vendors.findFirst({
      where: (v, { and, eq }) => and(eq(v.organizationId, orgId), eq(v.id, params.vendorId)),
    });
    const vendorEmail = (vendor?.contactInfo as any)?.email;
    if (!vendor || !vendorEmail) return;

    const settings = await this.settingsService.getAll(orgId);
    const smtpHost = settings['smtp_host'] || '';
    if (!smtpHost) return;

    const appName = settings['app_name'] || 'BetterSpend';
    const subject =
      params.status === 'accepted'
        ? `[${appName}] RFQ ${params.rfqNumber} Awarded`
        : `[${appName}] RFQ ${params.rfqNumber} Update`;
    const summary =
      params.status === 'accepted'
        ? `Your response for RFQ ${params.rfqNumber} has been selected.`
        : `Your response for RFQ ${params.rfqNumber} was not selected.`;
    const detail =
      params.status === 'accepted' && params.purchaseOrderNumber
        ? `Purchase order ${params.purchaseOrderNumber} has been created from the award decision.`
        : params.reason
          ? `Reason: ${params.reason}`
          : 'Thank you for participating in the sourcing event.';
    const safeVendorName = escapeHtml(vendor.name);
    const safeSummary = escapeHtml(summary);
    const safeTitle = params.rfqTitle ? escapeHtml(params.rfqTitle) : null;
    const safeDetail = escapeHtml(detail);
    const safeAppName = escapeHtml(appName);

    await this.mailService.sendMail(
      {
        host: smtpHost,
        port: parseInt(settings['smtp_port'] || '587', 10),
        secure: settings['smtp_secure'] === 'true',
        user: settings['smtp_user'] || '',
        pass: settings['smtp_pass'] || '',
        from: settings['smtp_from'] || `noreply@${smtpHost}`,
        targetPolicy: 'public-only',
      },
      {
        to: vendorEmail,
        subject,
        html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#0f172a">${params.status === 'accepted' ? 'RFQ Awarded' : 'RFQ Response Update'}</h2>
          <p>Dear ${safeVendorName},</p>
          <p>${safeSummary}</p>
          ${safeTitle ? `<p><strong>${safeTitle}</strong></p>` : ''}
          <p>${safeDetail}</p>
          <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0">
          <p style="color:#94a3b8;font-size:12px">This is an automated notification from ${safeAppName}.</p>
        </div>
      `,
        text: `${summary}\n\n${detail}`,
      },
    );
  }

  private async nextPoNumber(orgId: string): Promise<string> {
    const year = new Date().getFullYear();
    const rows = await this.db
      .update(sequences)
      .set({ lastValue: sql`${sequences.lastValue} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(sequences.organizationId, orgId),
          eq(sequences.entityType, 'purchase_order'),
          eq(sequences.year, year),
        ),
      )
      .returning();
    if (!rows.length) {
      await this.db.insert(sequences).values({
        organizationId: orgId,
        entityType: 'purchase_order',
        year,
        lastValue: 1,
      });
      return `PO-${year}-0001`;
    }
    return `PO-${year}-${String(rows[0].lastValue).padStart(4, '0')}`;
  }

  async list(orgId: string) {
    const rows = await this.db
      .select({
        rfq: rfqRequests,
        requester: { id: users.id, name: users.name, email: users.email },
        awardedVendor: { id: vendors.id, name: vendors.name },
      })
      .from(rfqRequests)
      .leftJoin(users, eq(rfqRequests.requesterId, users.id))
      .leftJoin(
        vendors,
        and(eq(rfqRequests.awardedVendorId, vendors.id), eq(vendors.organizationId, orgId)),
      )
      .where(eq(rfqRequests.organizationId, orgId))
      .orderBy(desc(rfqRequests.createdAt));

    // Attach invitation/response counts
    const rfqIds = rows.map((r) => r.rfq.id);
    if (!rfqIds.length) return [];

    const invCounts = await this.db
      .select({ rfqId: rfqInvitations.rfqId, count: sql<number>`COUNT(*)` })
      .from(rfqInvitations)
      .where(inArray(rfqInvitations.rfqId, rfqIds))
      .groupBy(rfqInvitations.rfqId);

    const resCounts = await this.db
      .select({ rfqId: rfqResponses.rfqId, count: sql<number>`COUNT(*)` })
      .from(rfqResponses)
      .where(inArray(rfqResponses.rfqId, rfqIds))
      .groupBy(rfqResponses.rfqId);

    const invMap = Object.fromEntries(invCounts.map((r) => [r.rfqId, Number(r.count)]));
    const resMap = Object.fromEntries(resCounts.map((r) => [r.rfqId, Number(r.count)]));

    return rows.map((r) => ({
      ...withoutOwnerIdempotencyKey(r.rfq),
      requester: r.requester,
      awardedVendor: r.awardedVendor,
      invitationCount: invMap[r.rfq.id] ?? 0,
      responseCount: resMap[r.rfq.id] ?? 0,
    }));
  }

  async findOne(orgId: string, id: string) {
    const [row] = await this.db
      .select({
        rfq: rfqRequests,
        requester: { id: users.id, name: users.name, email: users.email },
        awardedVendor: { id: vendors.id, name: vendors.name },
      })
      .from(rfqRequests)
      .leftJoin(users, eq(rfqRequests.requesterId, users.id))
      .leftJoin(
        vendors,
        and(eq(rfqRequests.awardedVendorId, vendors.id), eq(vendors.organizationId, orgId)),
      )
      .where(and(eq(rfqRequests.organizationId, orgId), eq(rfqRequests.id, id)));

    if (!row) throw new NotFoundException('RFQ not found');

    const lines = await this.db
      .select()
      .from(rfqLines)
      .where(eq(rfqLines.rfqId, id))
      .orderBy(rfqLines.lineNumber);

    const invitations = await this.db
      .select({ inv: rfqInvitations, vendor: { id: vendors.id, name: vendors.name } })
      .from(rfqInvitations)
      .leftJoin(
        vendors,
        and(eq(rfqInvitations.vendorId, vendors.id), eq(vendors.organizationId, orgId)),
      )
      .where(eq(rfqInvitations.rfqId, id));

    const responses = await this.db
      .select({ res: rfqResponses, vendor: { id: vendors.id, name: vendors.name } })
      .from(rfqResponses)
      .innerJoin(
        vendors,
        and(eq(rfqResponses.vendorId, vendors.id), eq(vendors.organizationId, orgId)),
      )
      .where(eq(rfqResponses.rfqId, id))
      .orderBy(rfqResponses.totalAmount);

    const responseIds = responses.map((response) => response.res.id);
    const responseLineRows = responseIds.length
      ? await this.db
          .select({
            responseLine: rfqResponseLines,
            rfqLine: {
              id: rfqLines.id,
              description: rfqLines.description,
              quantity: rfqLines.quantity,
              unitOfMeasure: rfqLines.unitOfMeasure,
              targetPrice: rfqLines.targetPrice,
            },
          })
          .from(rfqResponseLines)
          .leftJoin(rfqLines, eq(rfqResponseLines.rfqLineId, rfqLines.id))
          .where(inArray(rfqResponseLines.responseId, responseIds))
      : [];

    const linesByResponseId = responseLineRows.reduce<Record<string, Array<any>>>((acc, row) => {
      const list = acc[row.responseLine.responseId] ?? [];
      list.push({
        ...row.responseLine,
        rfqLine: row.rfqLine,
      });
      acc[row.responseLine.responseId] = list;
      return acc;
    }, {});

    return {
      ...withoutOwnerIdempotencyKey(row.rfq),
      requester: row.requester,
      awardedVendor: row.awardedVendor,
      lines,
      invitations: invitations.map((i) => ({ ...i.inv, vendor: i.vendor })),
      responses: responses.map((r) => ({
        ...r.res,
        vendor: r.vendor,
        lines: linesByResponseId[r.res.id] ?? [],
      })),
    };
  }

  async create(
    orgId: string,
    userId: string,
    dto: {
      title: string;
      description?: string;
      dueDate?: string;
      currency?: string;
      notes?: string;
      lines: Array<{
        description: string;
        quantity: number;
        unitOfMeasure?: string;
        targetPrice?: number | string;
      }>;
      vendorIds?: string[];
    },
  ) {
    return this.createWithOwnerKey(orgId, userId, dto);
  }

  /** Internal artifact-owner path. Public HTTP input never reaches this parameter. */
  async createInternal(
    orgId: string,
    userId: string,
    dto: Parameters<RfqService['create']>[2],
    ownerIdempotencyKey: string,
  ) {
    return this.createWithOwnerKey(orgId, userId, dto, ownerIdempotencyKey);
  }

  private async createWithOwnerKey(
    orgId: string,
    userId: string,
    dto: Parameters<RfqService['create']>[2],
    ownerIdempotencyKey?: string,
  ) {
    const vendorIds = [...new Set(dto.vendorIds ?? [])];
    if (vendorIds.length) {
      const organizationVendors = await this.db
        .select({ id: vendors.id })
        .from(vendors)
        .where(and(eq(vendors.organizationId, orgId), inArray(vendors.id, vendorIds)));
      if (organizationVendors.length !== vendorIds.length) {
        throw new BadRequestException(
          'Every invited vendor must belong to the current organization',
        );
      }
    }

    const rfqId = await this.db.transaction(async (tx) => {
      const number = await this.sequenceService.next(orgId, 'rfq', tx);
      const values = {
        organizationId: orgId,
        requesterId: userId,
        number,
        title: dto.title,
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        currency: dto.currency ?? 'USD',
        notes: dto.notes,
        idempotencyKey: ownerIdempotencyKey,
      };
      const [rfq] = await tx.insert(rfqRequests).values(values).returning();
      if (!rfq) throw new Error('RFQ was not created');

      if (dto.lines?.length) {
        await tx.insert(rfqLines).values(
          dto.lines.map((l, i) => ({
            rfqId: rfq.id,
            lineNumber: i + 1,
            description: l.description,
            quantity: String(l.quantity),
            unitOfMeasure: l.unitOfMeasure ?? 'each',
            targetPrice: l.targetPrice != null ? normalizeMoney(l.targetPrice) : undefined,
          })),
        );
      }

      if (vendorIds.length) {
        await tx
          .insert(rfqInvitations)
          .values(vendorIds.map((vendorId) => ({ rfqId: rfq.id, vendorId })));
      }

      return rfq.id;
    });

    return this.findOne(orgId, rfqId);
  }

  async update(
    orgId: string,
    id: string,
    dto: {
      title?: string;
      description?: string;
      dueDate?: string;
      notes?: string;
      status?: string;
    },
  ) {
    const [rfq] = await this.db
      .update(rfqRequests)
      .set({
        ...(dto.title && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.dueDate && { dueDate: new Date(dto.dueDate) }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.status && { status: dto.status }),
        updatedAt: new Date(),
      })
      .where(and(eq(rfqRequests.organizationId, orgId), eq(rfqRequests.id, id)))
      .returning();

    if (!rfq) throw new NotFoundException('RFQ not found');
    return withoutOwnerIdempotencyKey(rfq);
  }

  async open(orgId: string, id: string, userId: string) {
    return this.db.transaction(async (tx) => {
      const [rfq] = await tx
        .update(rfqRequests)
        .set({ status: 'open', updatedAt: new Date() })
        .where(
          and(
            eq(rfqRequests.organizationId, orgId),
            eq(rfqRequests.id, id),
            eq(rfqRequests.status, 'draft'),
          ),
        )
        .returning();

      if (!rfq) {
        const [existing] = await tx
          .select({ status: rfqRequests.status })
          .from(rfqRequests)
          .where(and(eq(rfqRequests.organizationId, orgId), eq(rfqRequests.id, id)))
          .limit(1);
        if (!existing) throw new NotFoundException('RFQ not found');
        throw new BadRequestException('Only draft RFQs can be opened');
      }

      await appendAuditLog(tx, {
        organizationId: orgId,
        userId,
        entityType: 'rfq',
        entityId: id,
        action: 'opened',
        changes: { previousStatus: 'draft', status: 'open' },
      });
      return withoutOwnerIdempotencyKey(rfq);
    });
  }

  async close(orgId: string, id: string) {
    const rfq = await this.findOne(orgId, id);
    if (rfq.status !== 'open') throw new BadRequestException('Only open RFQs can be closed');
    return this.update(orgId, id, { status: 'closed' });
  }

  async award(orgId: string, id: string, responseId: string, userId: string) {
    const rfq = await this.findOne(orgId, id);
    if (!['closed', 'open'].includes(rfq.status)) {
      throw new BadRequestException('RFQ must be open or closed to award');
    }

    const [response] = await this.db
      .select({
        response: rfqResponses,
        vendor: vendors,
      })
      .from(rfqResponses)
      .innerJoin(
        vendors,
        and(eq(rfqResponses.vendorId, vendors.id), eq(vendors.organizationId, orgId)),
      )
      .where(and(eq(rfqResponses.id, responseId), eq(rfqResponses.rfqId, id)));

    if (!response) throw new NotFoundException('Response not found');

    const responseLines = await this.db
      .select({
        responseLine: rfqResponseLines,
        rfqLine: rfqLines,
      })
      .from(rfqResponseLines)
      .leftJoin(rfqLines, eq(rfqResponseLines.rfqLineId, rfqLines.id))
      .where(eq(rfqResponseLines.responseId, responseId))
      .orderBy(rfqLines.lineNumber);

    if (!responseLines.length) throw new BadRequestException('Response has no quoted line items');

    const poNumber = await this.nextPoNumber(orgId);

    let purchaseOrderId = '';

    await this.db.transaction(async (tx) => {
      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          organizationId: orgId,
          vendorId: response.response.vendorId,
          number: poNumber,
          version: 1,
          poType: 'standard',
          status: 'draft',
          issuedBy: userId,
          currency: rfq.currency,
          notes: `Created from RFQ ${rfq.number}${rfq.title ? `: ${rfq.title}` : ''}`,
          shippingAddress: {},
          billingAddress: {},
          subtotal: String(response.response.totalAmount),
          taxAmount: '0',
          totalAmount: String(response.response.totalAmount),
          baseCurrency: rfq.currency,
          exchangeRate: '1',
          baseSubtotal: String(response.response.totalAmount),
          baseTaxAmount: '0',
          baseTotalAmount: String(response.response.totalAmount),
        })
        .returning();

      purchaseOrderId = po.id;

      await tx.insert(poLines).values(
        responseLines.map((row, index) => ({
          purchaseOrderId: po.id,
          lineNumber: index + 1,
          description: row.rfqLine?.description ?? `RFQ line ${index + 1}`,
          quantity: row.rfqLine?.quantity ?? '1',
          unitOfMeasure: row.rfqLine?.unitOfMeasure ?? 'each',
          unitPrice: String(row.responseLine.unitPrice),
          totalPrice: String(row.responseLine.totalPrice),
        })),
      );

      await tx
        .update(rfqResponses)
        .set({
          awarded: false,
          status: sql`case when ${rfqResponses.id} = ${responseId} then 'accepted' else 'rejected' end`,
        })
        .where(eq(rfqResponses.rfqId, id));

      await tx
        .update(rfqRequests)
        .set({
          status: 'awarded',
          awardedVendorId: response.response.vendorId,
          updatedAt: new Date(),
        })
        .where(eq(rfqRequests.id, id));
    });

    await this.db
      .update(rfqResponses)
      .set({ awarded: true, status: 'accepted' })
      .where(eq(rfqResponses.id, responseId));

    const otherResponses = rfq.responses.filter((item) => item.id !== responseId);
    await Promise.all([
      this.sendDecisionEmail(orgId, {
        vendorId: response.response.vendorId,
        rfqNumber: rfq.number,
        rfqTitle: rfq.title,
        status: 'accepted',
        purchaseOrderNumber: poNumber,
      }),
      ...otherResponses.map((item) =>
        this.sendDecisionEmail(orgId, {
          vendorId: item.vendorId,
          rfqNumber: rfq.number,
          rfqTitle: rfq.title,
          status: 'rejected',
          reason: 'Another response was selected for award.',
        }),
      ),
    ]);

    const updatedRfq = await this.findOne(orgId, id);
    return {
      rfq: updatedRfq,
      purchaseOrderId,
      purchaseOrderNumber: poNumber,
    };
  }

  async rejectResponse(orgId: string, rfqId: string, responseId: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException('Rejection reason is required');
    const rfq = await this.findOne(orgId, rfqId);
    if (rfq.status === 'awarded')
      throw new BadRequestException('Cannot reject responses after the RFQ has been awarded');

    const [response] = await this.db
      .select()
      .from(rfqResponses)
      .where(and(eq(rfqResponses.id, responseId), eq(rfqResponses.rfqId, rfqId)));

    if (!response) throw new NotFoundException('Response not found');

    await this.db
      .update(rfqResponses)
      .set({
        status: 'rejected',
        notes: response.notes
          ? `${response.notes}\n\nRejected: ${reason.trim()}`
          : `Rejected: ${reason.trim()}`,
      })
      .where(eq(rfqResponses.id, responseId));

    await this.sendDecisionEmail(orgId, {
      vendorId: response.vendorId,
      rfqNumber: rfq.number,
      rfqTitle: rfq.title,
      status: 'rejected',
      reason: reason.trim(),
    });

    return this.findOne(orgId, rfqId);
  }

  async submitResponse(
    orgId: string,
    rfqId: string,
    dto: {
      vendorId: string;
      notes?: string;
      validUntil?: string;
      lines: Array<{ rfqLineId: string; unitPrice: number; leadTimeDays?: number; notes?: string }>;
    },
  ) {
    const rfq = await this.findOne(orgId, rfqId);
    if (rfq.status !== 'open') throw new BadRequestException('RFQ is not open for responses');

    const [invitation] = await this.db
      .select({ id: rfqInvitations.id })
      .from(rfqInvitations)
      .innerJoin(vendors, eq(rfqInvitations.vendorId, vendors.id))
      .where(
        and(
          eq(rfqInvitations.rfqId, rfqId),
          eq(rfqInvitations.vendorId, dto.vendorId),
          eq(vendors.organizationId, orgId),
        ),
      );
    if (!invitation) {
      throw new ForbiddenException('Only an invited vendor may submit an RFQ response');
    }

    const rfqLinesList = await this.db.select().from(rfqLines).where(eq(rfqLines.rfqId, rfqId));
    const lineMap = Object.fromEntries(rfqLinesList.map((l) => [l.id, l]));

    // A response may only quote lines that belong to this RFQ; otherwise an
    // award could copy a foreign line's description and quantity into a PO.
    const unknownLineIds = dto.lines.filter((l) => !lineMap[l.rfqLineId]);
    if (unknownLineIds.length > 0) {
      throw new BadRequestException(
        `Response lines reference items outside this RFQ: ${unknownLineIds.map((l) => l.rfqLineId).join(', ')}`,
      );
    }

    const seenLineIds = new Set<string>();
    const duplicateLineIds = dto.lines
      .filter(({ rfqLineId }) => {
        if (seenLineIds.has(rfqLineId)) return true;
        seenLineIds.add(rfqLineId);
        return false;
      })
      .map(({ rfqLineId }) => rfqLineId);
    if (duplicateLineIds.length > 0) {
      throw new BadRequestException(
        `Response lines must quote each RFQ line once: ${duplicateLineIds.join(', ')}`,
      );
    }

    const fractionalCentLines = dto.lines.filter(
      (line) =>
        !Number.isFinite(line.unitPrice) || Number(line.unitPrice.toFixed(2)) !== line.unitPrice,
    );
    if (fractionalCentLines.length > 0) {
      throw new BadRequestException(
        `Response line unit prices must use at most two decimal places: ${fractionalCentLines
          .map((line) => line.rfqLineId)
          .join(', ')}`,
      );
    }

    // Normalize once so the response total, persisted lines, and any awarded
    // PO all use the exact same quantity-aware values.
    const normalizedLines = dto.lines.map((line) => ({
      ...line,
      lineTotal: Math.round(line.unitPrice * Number(lineMap[line.rfqLineId].quantity) * 100) / 100,
    }));
    const totalAmount = normalizedLines.reduce((sum, line) => sum + line.lineTotal, 0);

    const [response] = await this.db
      .insert(rfqResponses)
      .values({
        rfqId,
        vendorId: dto.vendorId,
        totalAmount: String(totalAmount),
        notes: dto.notes,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      })
      .returning();

    if (dto.lines.length) {
      await this.db.insert(rfqResponseLines).values(
        normalizedLines.map((line) => ({
          responseId: response.id,
          rfqLineId: line.rfqLineId,
          unitPrice: String(line.unitPrice),
          totalPrice: String(line.lineTotal),
          leadTimeDays: line.leadTimeDays,
          notes: line.notes,
        })),
      );
    }

    // Update invitation respondedAt
    await this.db
      .update(rfqInvitations)
      .set({ respondedAt: new Date() })
      .where(and(eq(rfqInvitations.rfqId, rfqId), eq(rfqInvitations.vendorId, dto.vendorId)));

    return response;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}

export function withoutOwnerIdempotencyKey<T extends { idempotencyKey?: unknown }>(row: T) {
  const { idempotencyKey: _privateOwnerKey, ...publicRow } = row;
  return publicRow;
}
