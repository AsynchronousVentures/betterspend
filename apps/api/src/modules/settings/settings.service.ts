import { Injectable, Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db, DbTransaction } from '@betterspend/db';
import { auditLog, systemSettings } from '@betterspend/db';
import { DEFAULT_SETTINGS, type SettingKey } from '@betterspend/shared';

@Injectable()
export class SettingsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async getAll(
    organizationId: string,
    executor: Db | DbTransaction = this.db,
  ): Promise<Record<string, string>> {
    const rows = await executor.query.systemSettings.findMany({
      where: (s, { eq }) => eq(s.organizationId, organizationId),
    });

    // Start with defaults and overlay org-specific values
    const result: Record<string, string> = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      result[row.key] = row.value ?? '';
    }
    return result;
  }

  async get(
    organizationId: string,
    key: SettingKey,
    executor: Db | DbTransaction = this.db,
  ): Promise<string> {
    const row = await executor.query.systemSettings.findFirst({
      where: (s, { and, eq }) => and(eq(s.organizationId, organizationId), eq(s.key, key)),
    });
    return row?.value ?? DEFAULT_SETTINGS[key] ?? '';
  }

  async upsert(organizationId: string, key: string, value: string): Promise<void> {
    await this.db
      .insert(systemSettings)
      .values({ organizationId, key, value })
      .onConflictDoUpdate({
        target: [systemSettings.organizationId, systemSettings.key],
        set: { value, updatedAt: new Date() },
      });
  }

  async updateMany(
    organizationId: string,
    settings: Record<string, string>,
  ): Promise<Record<string, string>> {
    // Upsert each key
    for (const [key, value] of Object.entries(settings)) {
      await this.upsert(organizationId, key, value);
    }
    return this.getAll(organizationId);
  }

  async updateManyWithAudit(
    organizationId: string,
    userId: string,
    settings: Record<string, string>,
    action: string,
  ): Promise<Record<string, string>> {
    await this.db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(settings)) {
        await tx
          .insert(systemSettings)
          .values({ organizationId, key, value })
          .onConflictDoUpdate({
            target: [systemSettings.organizationId, systemSettings.key],
            set: { value, updatedAt: new Date() },
          });
      }
      await tx.insert(auditLog).values({
        organizationId,
        userId,
        entityType: 'organization_settings',
        entityId: organizationId,
        action,
        changes: settings,
      });
    });
    return this.getAll(organizationId);
  }

  /** Returns only public (non-sensitive) branding settings — safe to expose to frontend without auth */
  async getBranding(organizationId: string) {
    const all = await this.getAll(organizationId);
    return this.pickBranding(all);
  }

  /** BetterSpend is single-tenant, so public login branding belongs to the sole organization. */
  async getPublicBranding() {
    const organization = await this.db.query.organizations.findFirst({
      columns: { id: true },
    });
    const all = organization ? await this.getAll(organization.id) : DEFAULT_SETTINGS;
    return this.pickBranding(all);
  }

  private pickBranding(all: Record<string, string>) {
    return {
      app_name: all.app_name,
      app_logo_url: all.app_logo_url,
      app_favicon_url: all.app_favicon_url,
      copyright_text: all.copyright_text,
      primary_color: all.primary_color,
      accent_color: all.accent_color,
      hide_powered_by: all.hide_powered_by,
    };
  }
}
