import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { ResourceScope } from '@betterspend/shared';

export interface ScopeSqlColumns {
  department?: SQLWrapper;
  project?: SQLWrapper;
  entity?: SQLWrapper;
  owner?: SQLWrapper;
}

/**
 * Translate an effective resource scope into a fail-closed SQL predicate.
 * Callers provide the columns for the rows they are selecting, including
 * COALESCE expressions when an outer join can leave a dimension nullable.
 */
export function scopePredicate(
  scope: ResourceScope | undefined,
  columns: ScopeSqlColumns,
): SQL {
  if (!scope || scope.unrestricted) return sql`true`;

  if (scope.ownOnly && !columns.owner) return sql`false`;

  const dimensionClauses: SQL[] = [
    ...scope.departmentIds.map((id) =>
      columns.department ? sql`${columns.department} = ${id}` : null,
    ),
    ...scope.projectIds.map((id) =>
      columns.project ? sql`${columns.project} = ${id}` : null,
    ),
    ...scope.entityIds.map((id) =>
      columns.entity ? sql`${columns.entity} = ${id}` : null,
    ),
  ].filter((clause): clause is SQL => clause !== null);

  const dimensions =
    dimensionClauses.length > 0 ? sql`(${sql.join(dimensionClauses, sql` OR `)})` : null;
  const owner = scope.ownOnly ? sql`${columns.owner} = ${scope.userId}` : null;

  if (!dimensions && !owner) return sql`false`;
  if (!dimensions) return owner!;
  if (!owner) return dimensions;
  return sql`(${owner} AND ${dimensions})`;
}

export function globalOnlyPredicate(scope: ResourceScope | undefined): SQL {
  return !scope || scope.unrestricted ? sql`true` : sql`false`;
}
