import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { recordHref } from '@betterspend/shared';
import type { RelatedRecord } from './related-records';

function hasLink(record: RelatedRecord): record is RelatedRecord & { id: string; label: string } {
  return Boolean(record.id && record.label);
}

/** Shows only the existing record path, so a lifecycle never implies missing work. */
export function LifecycleStrip({
  records,
  current,
}: {
  records: readonly RelatedRecord[];
  current?: Pick<RelatedRecord, 'kind' | 'id'>;
}) {
  const stages = records.filter(hasLink);
  if (stages.length < 2) return null;

  return (
    <section aria-labelledby="record-lifecycle-heading" className="border-y border-border/60 py-4">
      <h2
        id="record-lifecycle-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
      >
        Lifecycle
      </h2>
      <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        {stages.map((stage, index) => {
          const isCurrent = stage.kind === current?.kind && stage.id === current.id;

          return (
            <li key={`${stage.kind}:${stage.id}`} className="flex items-center gap-2">
              {index > 0 ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              ) : null}
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{stage.relation}</div>
                {isCurrent ? (
                  <span aria-current="page" className="block truncate font-medium text-foreground">
                    {stage.label}
                  </span>
                ) : (
                  <Link
                    href={recordHref(stage)}
                    className="block truncate font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {stage.label}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
