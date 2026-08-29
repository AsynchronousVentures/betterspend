import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DB_TOKEN } from '../../database/database.module';
import type { Db, DbTransaction } from '@betterspend/db';
import { vendors } from '@betterspend/db';
import {
  PUNCHOUT_AUTH_FAILURE_THRESHOLD,
  punchoutConfigInputSchema,
  punchoutEnvironmentSchema,
  punchoutStoredConfigSchema,
  type PunchoutConfigInput,
  type PunchoutConfigResponse,
  type PunchoutEnvironment,
  type PunchoutEnvironmentInput,
  type PunchoutStoredConfig,
  type PunchoutStoredEnvironment,
} from '@betterspend/shared';
import type {
  PunchOutSetupRequest,
  PunchOutSetupResponse,
  PunchOutOrderMessage,
  CxmlCartItem,
} from './cxml.types';
import type { AccessPolicy } from '../auth/access-policy';
import { scopedVendorPredicate } from '../auth/operational-access';
import { CredentialCryptoService } from '../ai-providers/credential-crypto.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { resolveOrganizationAdminId } from '../../common/demo-identity';

// In-memory session store (replace with Redis in production)
const sessions = new Map<
  string,
  { vendorId: string; buyerCookie: string; returnUrl: string; createdAt: Date }
>();

@Injectable()
export class PunchoutService {
  private readonly logger = new Logger(PunchoutService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly credentialCrypto: CredentialCryptoService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Return a vendor's PunchOut settings without exposing stored credentials. */
  async getConfig(
    vendorId: string,
    organizationId: string,
    access?: AccessPolicy,
  ): Promise<PunchoutConfigResponse> {
    const vendor = await this.findConfigVendor(vendorId, organizationId, access, 'vendors:view');
    return toPunchoutConfigResponse(
      vendor.id,
      vendor.punchoutEnabled,
      parseStoredConfig(vendor.punchoutConfig),
    );
  }

  /**
   * Save PunchOut settings while preserving secrets that are omitted from a
   * partial update. Disabling only changes punchoutEnabled, so all stored
   * endpoints, identities, and encrypted credentials remain recoverable.
   */
  async updateConfig(
    vendorId: string,
    organizationId: string,
    userId: string,
    input: PunchoutConfigInput | unknown,
    access?: AccessPolicy,
  ): Promise<PunchoutConfigResponse> {
    const parsed = punchoutConfigInputSchema.parse(input);
    const result = await this.db.transaction(async (tx) => {
      const [vendor] = await tx
        .select()
        .from(vendors)
        .where(
          and(
            eq(vendors.id, vendorId),
            eq(vendors.organizationId, organizationId),
            scopedVendorPredicate(
              this.db,
              organizationId,
              access,
              'vendor',
              'vendors:edit',
              vendors.id,
            ),
          ),
        )
        .for('update');
      if (!vendor) throw new NotFoundException(`Vendor ${vendorId} not found`);

      const current = parseStoredConfig(vendor.punchoutConfig);
      const next = this.mergeConfig(current, parsed);
      const enabled = parsed.enabled ?? vendor.punchoutEnabled;
      if (enabled) this.assertEnvironmentComplete(next, next.activeEnvironment);

      const [updated] = await tx
        .update(vendors)
        .set({
          punchoutEnabled: enabled,
          punchoutConfig: next,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(vendors.id, vendorId),
            eq(vendors.organizationId, organizationId),
            scopedVendorPredicate(
              this.db,
              organizationId,
              access,
              'vendor',
              'vendors:edit',
              vendors.id,
            ),
          ),
        )
        .returning({ id: vendors.id, punchoutEnabled: vendors.punchoutEnabled });

      if (!updated) throw new NotFoundException(`Vendor ${vendorId} not found`);
      await this.auditChange(
        organizationId,
        userId,
        vendorId,
        'punchout_config_updated',
        {
          enabled: updated.punchoutEnabled,
          dialect: next.dialect,
          activeEnvironment: next.activeEnvironment,
        },
        tx,
      );
      return { next, enabled: updated.punchoutEnabled };
    });

    return toPunchoutConfigResponse(vendorId, result.enabled, result.next);
  }

  /** Record a supplier authentication failure and disable PunchOut at the threshold. */
  async recordAuthenticationFailure(
    vendorId: string,
    organizationId: string,
    environment: PunchoutEnvironment,
    _reason?: unknown,
  ): Promise<PunchoutConfigResponse> {
    const parsedEnvironment = punchoutEnvironmentSchema.parse(environment);
    const result = await this.db.transaction(async (tx) => {
      const [vendor] = await tx
        .select()
        .from(vendors)
        .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)))
        .for('update');
      if (!vendor) throw new NotFoundException(`Vendor ${vendorId} not found`);

      const current = parseStoredConfig(vendor.punchoutConfig);
      const existingEnvironment = current.environments[parsedEnvironment];
      const consecutiveAuthFailures = Math.min(
        existingEnvironment.consecutiveAuthFailures + 1,
        Number.MAX_SAFE_INTEGER,
      );
      const now = new Date().toISOString();
      const nextEnvironment: PunchoutStoredEnvironment = {
        ...existingEnvironment,
        status: 'auth_failed',
        consecutiveAuthFailures,
        lastCheckedAt: now,
        // Never persist supplier response bodies or caller-provided credentials.
        lastError: 'Supplier authentication failed',
      };
      const next: PunchoutStoredConfig = {
        ...current,
        environments: {
          ...current.environments,
          [parsedEnvironment]: nextEnvironment,
        },
      };
      const shouldDisable =
        parsedEnvironment === current.activeEnvironment &&
        consecutiveAuthFailures >= PUNCHOUT_AUTH_FAILURE_THRESHOLD;
      const autoDisabled = shouldDisable && vendor.punchoutEnabled;
      const [updated] = await tx
        .update(vendors)
        .set({
          punchoutConfig: next,
          punchoutEnabled: autoDisabled ? false : vendor.punchoutEnabled,
          updatedAt: new Date(),
        })
        .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)))
        .returning({ punchoutEnabled: vendors.punchoutEnabled });

      if (!updated) throw new NotFoundException(`Vendor ${vendorId} not found`);

      await this.auditChange(
        organizationId,
        null,
        vendorId,
        'punchout_authentication_failed',
        {
          environment: parsedEnvironment,
          consecutiveAuthFailures,
          autoDisabled,
        },
        tx,
      );
      if (autoDisabled) {
        await this.auditChange(
          organizationId,
          null,
          vendorId,
          'punchout_auto_disabled',
          {
            environment: parsedEnvironment,
            consecutiveAuthFailures,
          },
          tx,
        );
        await this.notifyAuthenticationFailure(
          organizationId,
          vendorId,
          vendor.name,
          parsedEnvironment,
          now,
          tx,
        );
      }

      return {
        response: toPunchoutConfigResponse(vendorId, updated.punchoutEnabled, next),
      };
    });

    return result.response;
  }

  /** Mark an environment healthy after a successful authenticated supplier call. */
  async recordAuthenticationSuccess(
    vendorId: string,
    organizationId: string,
    environment: PunchoutEnvironment,
  ): Promise<PunchoutConfigResponse> {
    const parsedEnvironment = punchoutEnvironmentSchema.parse(environment);
    return this.db.transaction(async (tx) => {
      const [vendor] = await tx
        .select()
        .from(vendors)
        .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)))
        .for('update');
      if (!vendor) throw new NotFoundException(`Vendor ${vendorId} not found`);

      const current = parseStoredConfig(vendor.punchoutConfig);
      const next: PunchoutStoredConfig = {
        ...current,
        environments: {
          ...current.environments,
          [parsedEnvironment]: {
            ...current.environments[parsedEnvironment],
            status: 'verified',
            consecutiveAuthFailures: 0,
            lastCheckedAt: new Date().toISOString(),
            lastError: null,
          },
        },
      };
      const [updated] = await tx
        .update(vendors)
        .set({ punchoutConfig: next, updatedAt: new Date() })
        .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)))
        .returning({ punchoutEnabled: vendors.punchoutEnabled });
      if (!updated) throw new NotFoundException(`Vendor ${vendorId} not found`);

      await this.auditChange(
        organizationId,
        null,
        vendorId,
        'punchout_authentication_succeeded',
        {
          environment: parsedEnvironment,
        },
        tx,
      );

      return toPunchoutConfigResponse(vendorId, updated.punchoutEnabled, next);
    });
  }

  /**
   * Handles a PunchOutSetupRequest from a buyer system.
   * Creates a session token and returns a start-page URL.
   *
   * Phase 5b: validate sharedSecret HMAC, serve a real hosted catalog page.
   */
  async handleSetupRequest(
    vendorId: string,
    organizationId: string,
    request: PunchOutSetupRequest,
    access?: AccessPolicy,
  ): Promise<PunchOutSetupResponse> {
    const vendor = await this.db.query.vendors.findFirst({
      columns: { punchoutConfig: false },
      where: (v, { and, eq }) =>
        and(
          eq(v.id, vendorId),
          eq(v.organizationId, organizationId),
          scopedVendorPredicate(this.db, organizationId, access, 'catalog', 'catalog:view', v.id),
        ),
    });

    if (!vendor) {
      throw new BadRequestException(`Vendor ${vendorId} not found`);
    }

    if (!vendor.punchoutEnabled) {
      throw new BadRequestException(`Punchout is not enabled for vendor ${vendor.name}`);
    }

    const sessionToken = randomBytes(32).toString('hex');
    sessions.set(sessionToken, {
      vendorId,
      buyerCookie: request.buyerCookie,
      returnUrl: request.browserFormPost.url,
      createdAt: new Date(),
    });

    // In production: URL points to hosted catalog page, includes sessionToken
    const startPageUrl = `${process.env.WEB_URL ?? 'http://localhost:3100'}/punchout/catalog?session=${sessionToken}&vendor=${vendorId}`;

    this.logger.log(`Punchout session created for vendor ${vendor.name}`);

    return {
      status: { code: 200, text: 'OK' },
      startPage: { url: startPageUrl },
    };
  }

  /**
   * Handles the OrderMessage POST when the user returns from the vendor catalog.
   * Converts cart items to requisition line format.
   *
   * Phase 5b: validate session, create a draft requisition from the cart.
   */
  async handleOrderReturn(
    sessionToken: string,
    message: PunchOutOrderMessage,
  ): Promise<{ sessionToken: string; vendorId: string; lines: ReturnType<typeof mapCartItem>[] }> {
    const session = sessions.get(sessionToken);
    if (!session) {
      throw new BadRequestException(`Invalid or expired punchout session`);
    }

    const lines = message.itemIn.map(mapCartItem);

    this.logger.log(`Punchout return received for ${lines.length} items`);

    // Clean up session
    sessions.delete(sessionToken);

    return { sessionToken, vendorId: session.vendorId, lines };
  }

  getSession(token: string) {
    return sessions.get(token) ?? null;
  }

  private async findConfigVendor(
    vendorId: string,
    organizationId: string,
    access?: AccessPolicy,
    permission: 'vendors:view' | 'vendors:edit' = 'vendors:edit',
  ) {
    const vendor = await this.db.query.vendors.findFirst({
      where: (v, { and, eq }) =>
        and(
          eq(v.id, vendorId),
          eq(v.organizationId, organizationId),
          scopedVendorPredicate(this.db, organizationId, access, 'vendor', permission, v.id),
        ),
    });
    if (!vendor) throw new NotFoundException(`Vendor ${vendorId} not found`);
    return vendor;
  }

  private mergeConfig(
    current: PunchoutStoredConfig,
    input: PunchoutConfigInput,
  ): PunchoutStoredConfig {
    const environments = {
      test: this.mergeEnvironment(current.environments.test, input.environments?.test),
      production: this.mergeEnvironment(
        current.environments.production,
        input.environments?.production,
      ),
    };
    return {
      dialect: input.dialect ?? current.dialect,
      activeEnvironment: input.activeEnvironment ?? current.activeEnvironment,
      environments,
    };
  }

  private mergeEnvironment(
    current: PunchoutStoredEnvironment,
    input: PunchoutEnvironmentInput | undefined,
  ): PunchoutStoredEnvironment {
    const next = { ...current } as PunchoutStoredEnvironment;
    if (!input) return next;

    const {
      sharedSecret,
      setupUrl,
      orderUrl,
      fromDomain,
      fromIdentity,
      toDomain,
      toIdentity,
      senderIdentity,
    } = input;
    let changed = false;
    if (setupUrl !== undefined) {
      next.setupUrl = setupUrl;
      changed = true;
    }
    if (orderUrl !== undefined) {
      next.orderUrl = orderUrl;
      changed = true;
    }
    if (fromDomain !== undefined) {
      next.fromDomain = fromDomain;
      changed = true;
    }
    if (fromIdentity !== undefined) {
      next.fromIdentity = fromIdentity;
      changed = true;
    }
    if (toDomain !== undefined) {
      next.toDomain = toDomain;
      changed = true;
    }
    if (toIdentity !== undefined) {
      next.toIdentity = toIdentity;
      changed = true;
    }
    if (senderIdentity !== undefined) {
      next.senderIdentity = senderIdentity;
      changed = true;
    }
    if (changed) {
      next.status = 'unverified';
      next.consecutiveAuthFailures = 0;
      next.lastCheckedAt = null;
      next.lastError = null;
    }
    if (sharedSecret !== undefined) {
      next.encryptedSharedSecret = this.credentialCrypto.encrypt(sharedSecret);
      next.sharedSecretHint = maskSharedSecret(sharedSecret);
      next.status = 'unverified';
      next.consecutiveAuthFailures = 0;
      next.lastCheckedAt = null;
      next.lastError = null;
    }
    return next;
  }

  private assertEnvironmentComplete(
    config: PunchoutStoredConfig,
    environment: PunchoutEnvironment,
  ) {
    const selected = config.environments[environment];
    const required: Array<keyof PunchoutStoredEnvironment> = [
      'setupUrl',
      'orderUrl',
      'fromDomain',
      'fromIdentity',
      'toDomain',
      'toIdentity',
      'senderIdentity',
      'encryptedSharedSecret',
    ];
    if (required.some((key) => !selected[key])) {
      throw new BadRequestException(
        `${environment} PunchOut settings require endpoints, identities, and a shared secret`,
      );
    }
  }

  private async notifyAuthenticationFailure(
    organizationId: string,
    vendorId: string,
    vendorName: string,
    environment: PunchoutEnvironment,
    transitionId: string,
    transaction: DbTransaction,
  ) {
    const adminId = await resolveOrganizationAdminId(transaction, organizationId);
    if (!adminId) return;
    const idempotencyKey = `punchout-auth-failed:${vendorId}:${environment}:${transitionId}`;
    const title = 'PunchOut connection disabled';
    const body = `PunchOut for ${vendorName} was disabled after ${PUNCHOUT_AUTH_FAILURE_THRESHOLD} authentication failures in ${environment} credentials. Stored configuration was retained.`;
    if (typeof this.notifications.createIdempotent === 'function') {
      await this.notifications.createIdempotent(
        idempotencyKey,
        organizationId,
        adminId,
        'punchout_auth_failed',
        title,
        body,
        'vendor',
        vendorId,
        transaction,
      );
      return;
    }
    await this.notifications.create(
      organizationId,
      adminId,
      'punchout_auth_failed',
      title,
      body,
      'vendor',
      vendorId,
      transaction,
    );
  }

  private async auditChange(
    organizationId: string,
    userId: string | null,
    vendorId: string,
    action: string,
    changes: Record<string, unknown>,
    executor: DbTransaction,
  ) {
    await this.audit.log(
      organizationId,
      userId,
      'vendor',
      vendorId,
      action,
      changes,
      undefined,
      executor,
    );
  }
}

function emptyStoredConfig(): PunchoutStoredConfig {
  return punchoutStoredConfigSchema.parse({ environments: {} });
}

function parseStoredConfig(value: unknown): PunchoutStoredConfig {
  const parsed = punchoutStoredConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyStoredConfig();
}

function maskSharedSecret(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 4) return '••••';
  return `••••••••${normalized.slice(-4)}`;
}

function toPunchoutConfigResponse(
  vendorId: string,
  enabled: boolean,
  config: PunchoutStoredConfig,
): PunchoutConfigResponse {
  return {
    vendorId,
    enabled,
    dialect: config.dialect,
    activeEnvironment: config.activeEnvironment,
    environments: {
      test: toMaskedEnvironment(config.environments.test),
      production: toMaskedEnvironment(config.environments.production),
    },
  };
}

function toMaskedEnvironment(environment: PunchoutStoredEnvironment) {
  return {
    setupUrl: environment.setupUrl ?? null,
    orderUrl: environment.orderUrl ?? null,
    fromDomain: environment.fromDomain ?? null,
    fromIdentity: environment.fromIdentity ?? null,
    toDomain: environment.toDomain ?? null,
    toIdentity: environment.toIdentity ?? null,
    senderIdentity: environment.senderIdentity ?? null,
    sharedSecretConfigured: Boolean(environment.encryptedSharedSecret),
    sharedSecretMasked: environment.encryptedSharedSecret
      ? (environment.sharedSecretHint ?? '••••')
      : null,
    status: environment.status,
    consecutiveAuthFailures: environment.consecutiveAuthFailures,
    lastCheckedAt: environment.lastCheckedAt,
    lastError: environment.lastError,
  };
}

function mapCartItem(item: CxmlCartItem) {
  return {
    description: item.description,
    quantity: item.quantity,
    unitOfMeasure: item.unitOfMeasure ?? 'each',
    unitPrice: item.unitPrice,
    vendorPartId: item.supplierPartId ?? null,
    extrinsic: item.extrinsic ?? {},
  };
}
