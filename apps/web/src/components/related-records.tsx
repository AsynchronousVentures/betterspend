import Link from 'next/link';
import type { ReactNode } from 'react';
import { recordHref, type RecordKind } from '@betterspend/shared';
import { cn } from '../lib/utils';

export interface RelatedRecord {
  kind: RecordKind;
  id: string | null | undefined;
  label: string | null | undefined;
  relation: string;
}

function isLinkedRecord(
  record: RelatedRecord,
): record is RelatedRecord & { id: string; label: string } {
  return Boolean(record.id && record.label);
}

/** A compact, deduplicated set of links to records connected to the current detail view. */
export function RelatedRecords({
  records,
  className,
}: {
  records: readonly RelatedRecord[];
  className?: string;
}) {
  const linkedRecords = records.filter(isLinkedRecord).filter((record, index, all) => {
    return (
      all.findIndex((candidate) => candidate.kind === record.kind && candidate.id === record.id) ===
      index
    );
  });

  if (linkedRecords.length === 0) return null;

  return (
    <section
      aria-labelledby="related-records-heading"
      className={cn('border-y border-border/60 py-4', className)}
    >
      <h2
        id="related-records-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
      >
        Related
      </h2>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {linkedRecords.map((record) => (
          <li key={`${record.kind}:${record.id}`} className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-muted-foreground">{record.relation}</span>
            <Link
              href={recordHref(record)}
              className="truncate font-medium text-primary underline-offset-4 hover:underline"
            >
              {record.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Renders an inline link only when a related record is available. */
export function RelatedRecordLink({
  record,
  className,
  fallback = '—',
}: {
  record: RelatedRecord;
  className?: string;
  fallback?: ReactNode;
}) {
  if (!isLinkedRecord(record)) return <>{fallback}</>;

  return (
    <Link href={recordHref(record)} className={cn('text-primary hover:underline', className)}>
      {record.label}
    </Link>
  );
}
