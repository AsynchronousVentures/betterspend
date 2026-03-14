import { Badge, type BadgeProps } from './ui/badge';

const VARIANT_MAP: Record<string, NonNullable<BadgeProps['variant']>> = {
  active: 'success',
  approved: 'success',
  matched: 'success',
  full_match: 'success',
  issued: 'default',
  partial_match: 'default',
  converted: 'default',
  received: 'default',
  pending: 'warning',
  pending_match: 'warning',
  pending_approval: 'warning',
  draft: 'secondary',
  inactive: 'secondary',
  cancelled: 'secondary',
  closed: 'secondary',
  paid: 'secondary',
  blocked: 'destructive',
  rejected: 'destructive',
  exception: 'destructive',
  unmatched: 'outline',
  invoiced: 'warning',
};

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function StatusBadge({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  return (
    <Badge variant={VARIANT_MAP[value] ?? 'outline'} className={className}>
      {label ?? humanize(value)}
    </Badge>
  );
}
