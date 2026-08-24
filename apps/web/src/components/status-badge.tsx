import { Badge, type BadgeProps } from './ui/badge';
import { SYNC_RECORD_STATUS, type SyncRecordStatus } from '@betterspend/shared';

const SYNC_RECORD_VARIANTS: Record<SyncRecordStatus, NonNullable<BadgeProps['variant']>> = {
  [SYNC_RECORD_STATUS.PENDING]: 'warning',
  [SYNC_RECORD_STATUS.QUEUED]: 'warning',
  [SYNC_RECORD_STATUS.SKIPPED]: 'secondary',
  [SYNC_RECORD_STATUS.SYNCED]: 'success',
  [SYNC_RECORD_STATUS.FAILED]: 'destructive',
};

const VARIANT_MAP: Record<string, NonNullable<BadgeProps['variant']>> = {
  ...SYNC_RECORD_VARIANTS,
  active: 'success',
  approved: 'success',
  matched: 'success',
  clear: 'success',
  full_match: 'success',
  issued: 'default',
  partial_match: 'default',
  converted: 'default',
  received: 'default',
  pending_match: 'warning',
  pending_approval: 'warning',
  manually_reviewed: 'warning',
  draft: 'secondary',
  inactive: 'secondary',
  cancelled: 'secondary',
  closed: 'secondary',
  paid: 'secondary',
  blocked: 'destructive',
  rejected: 'destructive',
  flagged: 'destructive',
  exception: 'destructive',
  unmatched: 'outline',
  invoiced: 'warning',
  untested: 'outline',
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
