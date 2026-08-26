import { isApprovableRecordKind, recordHref } from '@betterspend/shared';

export interface ApprovalEntitySummary {
  number?: string | null;
  title?: string | null;
  internalNumber?: string | null;
  invoiceNumber?: string | null;
  vendorName?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  matchStatus?: string | null;
  dueDate?: string | Date | null;
}

export function approvalEntityHref(type: string, id: string): string | null {
  return isApprovableRecordKind(type) ? recordHref({ kind: type, id }) : null;
}

export function approvalEntityLabel(
  type: string,
  entity: ApprovalEntitySummary | null | undefined,
): string {
  if (!entity) return 'Record unavailable';

  if (type === 'invoice') {
    const identifiers = [entity.internalNumber, entity.invoiceNumber].filter(
      (value): value is string => Boolean(value),
    );
    return identifiers.join(' / ') || 'Invoice';
  }

  const primary = entity.number ?? 'Record';
  const secondary = entity.title ?? entity.vendorName;
  return secondary ? `${primary} · ${secondary}` : primary;
}

export function formatApprovalAmount(
  amount: string | number | null | undefined,
  currency: string | null | undefined = 'USD',
): string {
  if (amount == null || Number.isNaN(Number(amount))) return 'Not available';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${currency || 'USD'}`;
  }
}

export function formatApprovalDate(value: string | Date | null | undefined): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleDateString();
}

export function formatApprovalStatus(value: string | null | undefined): string {
  if (!value) return 'Not available';
  return value.replace(/_/g, ' ');
}
