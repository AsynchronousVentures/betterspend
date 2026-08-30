export interface PaymentReleaseInvoiceSnapshot {
  status: string;
  approvedAt: Date | null;
  vendorName: string;
  vendorStatus: string;
  onboardingStatus: string;
  sanctionsStatus: string;
}

export interface PaymentReleaseAccountSnapshot {
  verificationStatus: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Keep the release gate's decision table behind one small interface so
 * payment-run orchestration and future provider adapters share the same
 * fail-closed checks.
 */
export function paymentReleaseBlockReason(
  invoice: PaymentReleaseInvoiceSnapshot,
  accounts: readonly PaymentReleaseAccountSnapshot[],
  expectedStatus: 'approved' | 'ready_for_release' = 'approved',
): string | null {
  if (invoice.status !== expectedStatus || !invoice.approvedAt) {
    return expectedStatus === 'approved'
      ? 'Only approved invoices can be released for payment'
      : 'Only released invoices can be paid';
  }
  if (invoice.vendorStatus !== 'active') {
    return `Vendor "${invoice.vendorName}" is not active`;
  }
  if (!['not_started', 'approved'].includes(invoice.onboardingStatus)) {
    return `Vendor "${invoice.vendorName}" has unresolved onboarding review`;
  }
  if (invoice.sanctionsStatus === 'flagged') {
    return `Vendor "${invoice.vendorName}" is flagged by sanctions screening`;
  }
  if (!accounts.some((account) => account.verificationStatus === 'verified')) {
    return `Vendor "${invoice.vendorName}" needs a verified payment account`;
  }
  if (
    accounts.some(
      (account) =>
        account.createdAt > invoice.approvedAt! || account.updatedAt > invoice.approvedAt!,
    )
  ) {
    return 'Vendor payment details changed after invoice approval; approve the invoice again';
  }
  return null;
}
