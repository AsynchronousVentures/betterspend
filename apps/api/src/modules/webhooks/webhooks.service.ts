import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { eq, and, desc } from 'drizzle-orm';
import { createHmac, randomBytes } from 'crypto';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { webhookEndpoints, webhookDeliveries } from '@betterspend/db';
import { enqueueWebhookDelivery } from './webhook-event.service';
import * as webhookUrlPolicy from './webhook-url-policy';

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [0, 30_000, 120_000, 600_000, 3_600_000]; // 0s, 30s, 2m, 10m, 1h

export interface CreateWebhookEndpointInput {
  url: string;
  events: string[];
  secret?: string;
}

export interface UpdateWebhookEndpointInput {
  url?: string;
  events?: string[];
  isActive?: boolean;
}

@Injectable()
export class WebhooksService implements OnModuleInit {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @InjectQueue('webhook-delivery') private readonly webhookQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const recoverable = await this.db.query.webhookDeliveries.findMany({
      where: (delivery, { inArray }) => inArray(delivery.status, ['pending', 'retrying']),
    });

    await Promise.all(
      recoverable.map((delivery) =>
        delivery.status === 'retrying'
          ? this.enqueueRetry(delivery.id, delivery.attempts, delivery.nextRetryAt ?? new Date())
          : this.enqueuePending(delivery.id),
      ),
    );

    if (recoverable.length > 0) {
      this.logger.log(`Recovered ${recoverable.length} webhook deliveries awaiting delivery`);
    }
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async findAll(organizationId: string) {
    return this.db.query.webhookEndpoints.findMany({
      where: (w, { eq }) => eq(w.organizationId, organizationId),
      orderBy: (w, { desc }) => desc(w.createdAt),
    });
  }

  async findOne(id: string, organizationId: string) {
    const endpoint = await this.db.query.webhookEndpoints.findFirst({
      where: (w, { and, eq }) => and(eq(w.id, id), eq(w.organizationId, organizationId)),
      with: { deliveries: { orderBy: (d, { desc }) => desc(d.createdAt), limit: 20 } },
    });
    if (!endpoint) throw new NotFoundException(`Webhook endpoint ${id} not found`);
    return endpoint;
  }

  async create(organizationId: string, input: CreateWebhookEndpointInput) {
    const secret = input.secret ?? randomBytes(32).toString('hex');
    const url = await this.validateConfiguredUrl(input.url);
    const [endpoint] = await this.db
      .insert(webhookEndpoints)
      .values({ organizationId, url, events: input.events, secret })
      .returning();
    return endpoint;
  }

  async update(id: string, organizationId: string, input: UpdateWebhookEndpointInput) {
    await this.findOne(id, organizationId);
    const changes: {
      url?: string;
      events?: string[];
      isActive?: boolean;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (input.url !== undefined) changes.url = await this.validateConfiguredUrl(input.url);
    if (input.events !== undefined) changes.events = input.events;
    if (input.isActive !== undefined) changes.isActive = input.isActive;
    const [updated] = await this.db
      .update(webhookEndpoints)
      .set(changes)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organizationId, organizationId)))
      .returning();
    return updated;
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    await this.db
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organizationId, organizationId)));
  }

  async listDeliveries(endpointId: string, organizationId: string) {
    await this.findOne(endpointId, organizationId); // validates ownership
    return this.db.query.webhookDeliveries.findMany({
      where: (d, { eq }) => eq(d.webhookEndpointId, endpointId),
      orderBy: (d, { desc }) => desc(d.createdAt),
      limit: 100,
    });
  }

  // ── Delivery ───────────────────────────────────────────────────────────────

  async dispatchEvent(
    organizationId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const endpoints = await this.db.query.webhookEndpoints.findMany({
      where: (w, { and, eq }) => and(eq(w.organizationId, organizationId), eq(w.isActive, true)),
    });

    const matched = endpoints.filter(
      (ep) => ep.events.length === 0 || ep.events.includes(eventType),
    );

    await Promise.all(
      matched.map((ep) => this.deliverToEndpoint(ep.id, ep.url, ep.secret, eventType, payload)),
    );
  }

  private async deliverToEndpoint(
    endpointId: string,
    url: string,
    secret: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // Create delivery record
    const [delivery] = await this.db
      .insert(webhookDeliveries)
      .values({
        webhookEndpointId: endpointId,
        eventType,
        payload: payload as Record<string, unknown>,
        status: 'pending',
        attempts: 0,
      })
      .returning();

    await this.attemptDelivery(delivery.id, { url, secret });
  }

  async retryDelivery(deliveryId: string): Promise<void> {
    const delivery = await this.db.query.webhookDeliveries.findFirst({
      where: (d, { eq }) => eq(d.id, deliveryId),
    });
    if (!delivery || delivery.status !== 'retrying') return;

    await this.attemptDelivery(deliveryId);
  }

  async processDelivery(deliveryId: string): Promise<void> {
    await this.attemptDelivery(deliveryId);
  }

  private async attemptDelivery(
    deliveryId: string,
    knownEndpoint?: { url: string; secret: string },
  ): Promise<void> {
    const delivery = await this.db.query.webhookDeliveries.findFirst({
      where: (d, { eq }) => eq(d.id, deliveryId),
    });
    if (!delivery || !['pending', 'retrying'].includes(delivery.status)) return;

    const endpoint =
      knownEndpoint ??
      (await this.db.query.webhookEndpoints.findFirst({
        where: (w, { eq }) => eq(w.id, delivery.webhookEndpointId),
      }));
    if (!endpoint) return;

    const body = JSON.stringify({
      event: delivery.eventType,
      timestamp: new Date().toISOString(),
      data: delivery.payload,
    });
    const signature = createHmac('sha256', endpoint.secret).update(body).digest('hex');

    const attempt = (delivery.attempts ?? 0) + 1;

    try {
      const target = await webhookUrlPolicy.resolveSafeWebhookTarget(endpoint.url);
      const response = await webhookUrlPolicy.requestPinnedWebhook(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-BetterSpend-Signature': `sha256=${signature}`,
          'X-BetterSpend-Event': delivery.eventType,
          'X-BetterSpend-Delivery': deliveryId,
        },
        body,
      });

      if (response.ok) {
        await this.db
          .update(webhookDeliveries)
          .set({
            status: 'delivered',
            attempts: attempt,
            responseStatus: response.status,
            responseBody: response.body,
            deliveredAt: new Date(),
            nextRetryAt: null,
            updatedAt: new Date(),
          })
          .where(eq(webhookDeliveries.id, deliveryId));
        return;
      }

      // Non-2xx: schedule retry
      await this.scheduleRetryOrFail(deliveryId, attempt, response.status, response.body);
    } catch (err: unknown) {
      this.logger.warn(`Webhook delivery ${deliveryId} attempt ${attempt} failed: ${String(err)}`);
      await this.scheduleRetryOrFail(deliveryId, attempt, null, String(err));
    }
  }

  private async scheduleRetryOrFail(
    deliveryId: string,
    attempt: number,
    responseStatus: number | null,
    responseBody: string,
  ): Promise<void> {
    if (attempt >= MAX_ATTEMPTS) {
      await this.db
        .update(webhookDeliveries)
        .set({
          status: 'failed',
          attempts: attempt,
          responseStatus,
          responseBody,
          nextRetryAt: null,
          updatedAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, deliveryId));
      this.logger.error(
        `Webhook delivery ${deliveryId} permanently failed after ${attempt} attempts`,
      );
      return;
    }

    const delayMs = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    const nextRetryAt = new Date(Date.now() + delayMs);

    await this.db
      .update(webhookDeliveries)
      .set({
        status: 'retrying',
        attempts: attempt,
        responseStatus,
        responseBody,
        nextRetryAt,
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    await this.enqueueRetry(deliveryId, attempt, nextRetryAt);
  }

  private async enqueueRetry(
    deliveryId: string,
    completedAttempts: number,
    nextRetryAt: Date,
  ): Promise<void> {
    await this.webhookQueue.add(
      'retry',
      { kind: 'retry', deliveryId },
      {
        delay: Math.max(0, nextRetryAt.getTime() - Date.now()),
        jobId: `webhook-retry-${deliveryId}-${completedAttempts + 1}`,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  private async enqueuePending(deliveryId: string): Promise<void> {
    await enqueueWebhookDelivery(this.webhookQueue, deliveryId);
  }

  private async validateConfiguredUrl(rawUrl: string): Promise<string> {
    try {
      const target = await webhookUrlPolicy.resolveSafeWebhookTarget(rawUrl);
      return `${target.protocol}//${target.hostHeader}${target.path}`;
    } catch (error: unknown) {
      if (error instanceof webhookUrlPolicy.WebhookUrlPolicyError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
