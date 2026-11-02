import { and, eq, notInArray } from 'drizzle-orm';
import type { DbTransaction } from './client';
import { vendorPortalUsers, vendors } from './schema';
import { hashVendorPortalPassword } from './vendor-portal-password';

type VendorPortalUserInsert = typeof vendorPortalUsers.$inferInsert;
export type VendorPortalUserSeedRow = Omit<VendorPortalUserInsert, 'passwordHash'>;

/** Shared password for every seeded supplier login; override with SEED_VENDOR_PORTAL_PASSWORD. */
export function demoVendorPortalPassword(): string {
  return process.env.SEED_VENDOR_PORTAL_PASSWORD?.trim() || 'VendorDemo123!';
}

/** The login email for a seeded vendor: its contact email, else one derived from its code. */
export function demoVendorPortalEmail(vendor: {
  code?: string | null;
  contactInfo?: unknown;
}): string {
  const contactEmail = (vendor.contactInfo as { email?: unknown } | null)?.email;
  if (typeof contactEmail === 'string' && contactEmail.includes('@')) {
    return contactEmail.trim().toLowerCase();
  }
  const slug = (vendor.code ?? 'vendor').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `portal-${slug}@vendor.example.invalid`;
}

/** Hash the shared demo password once and attach it to every seed row at persistence time. */
export async function materializeVendorPortalUsers(
  rows: readonly VendorPortalUserSeedRow[],
  password: string = demoVendorPortalPassword(),
): Promise<VendorPortalUserInsert[]> {
  if (rows.length === 0) return [];
  const passwordHash = await hashVendorPortalPassword(password);
  return rows.map((row) => ({ ...row, passwordHash }));
}

/**
 * Give every vendor in the organization that has no portal login one derived from its
 * contact email. Safe to rerun: vendors that already have a login are left alone.
 */
export async function upsertDemoVendorPortalLogins(
  tx: DbTransaction,
  organizationId: string,
  password: string = demoVendorPortalPassword(),
): Promise<{ created: number; email: string | null }> {
  const existing = await tx
    .select({ vendorId: vendorPortalUsers.vendorId, email: vendorPortalUsers.email })
    .from(vendorPortalUsers)
    .where(eq(vendorPortalUsers.organizationId, organizationId));
  const coveredVendorIds = existing.map((row) => row.vendorId);
  const takenEmails = new Set(existing.map((row) => row.email));

  const candidates = await tx
    .select({ id: vendors.id, code: vendors.code, contactInfo: vendors.contactInfo })
    .from(vendors)
    .where(
      coveredVendorIds.length > 0
        ? and(eq(vendors.organizationId, organizationId), notInArray(vendors.id, coveredVendorIds))
        : eq(vendors.organizationId, organizationId),
    );

  const rows: VendorPortalUserSeedRow[] = [];
  for (const vendor of candidates) {
    let email = demoVendorPortalEmail(vendor);
    if (takenEmails.has(email)) {
      email = demoVendorPortalEmail({ code: vendor.code, contactInfo: null });
    }
    if (takenEmails.has(email)) continue;
    takenEmails.add(email);
    rows.push({ organizationId, vendorId: vendor.id, email, name: 'Billing contact' });
  }

  if (rows.length > 0) {
    await tx.insert(vendorPortalUsers).values(await materializeVendorPortalUsers(rows, password));
  }
  return { created: rows.length, email: rows[0]?.email ?? existing[0]?.email ?? null };
}
