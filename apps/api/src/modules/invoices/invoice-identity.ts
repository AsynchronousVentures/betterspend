import { ConflictException } from '@nestjs/common';

// Drizzle wraps driver errors. Match only this constraint so unrelated database
// failures retain their original diagnostics and status.
export function rethrowInvoiceIdentityConflict(error: unknown): never {
  let current = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (
      'code' in current &&
      current.code === '23505' &&
      (('constraint_name' in current &&
        current.constraint_name === 'invoices_org_vendor_number_unique') ||
        ('constraint' in current && current.constraint === 'invoices_org_vendor_number_unique'))
    ) {
      throw new ConflictException('This invoice number already exists for this vendor');
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  throw error;
}
