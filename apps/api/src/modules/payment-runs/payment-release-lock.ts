import { sql } from 'drizzle-orm';
import type { DbTransaction } from '@betterspend/db';

/**
 * Return the stable lock namespace shared by release, payment, and account
 * changes for one organization/vendor pair.
 */
export function paymentReleaseVendorLockKey(organizationId: string, vendorId: string): string {
  return `betterspend:payment-release:${organizationId}:${vendorId}`;
}

/**
 * Serialize payment-release decisions and vendor account mutations. The
 * transaction-scoped advisory lock also covers a vendor with no account rows,
 * which a row lock on vendor_payment_accounts cannot do.
 */
export async function lockPaymentReleaseVendor(
  transaction: DbTransaction,
  organizationId: string,
  vendorId: string,
): Promise<void> {
  const key = paymentReleaseVendorLockKey(organizationId, vendorId);
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
