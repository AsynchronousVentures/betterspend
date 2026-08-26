import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { ResourceScope } from '@betterspend/shared';

export interface ScopeSqlColumns {
  department?: SQLWrapper;
  project?: SQLWrapper;
  entity?: SQLWrapper;
  owner?: SQLWrapper;
}

export interface ScopeIntersection {
  readonly kind: 'intersection';
  readonly scopes: readonly ResourceScope[];
}

export type ScopeConstraint = ResourceScope | ScopeIntersection;

function isScopeIntersection(scope: ScopeConstraint): scope is ScopeIntersection {
  return 'kind' in scope && scope.kind === 'intersection';
}

/**
 * Combine permission scopes as a resource-set intersection. An unrestricted
 * grant does not narrow a scoped grant, while multiple scoped grants must all
 * match the row before it is visible.
 */
export function intersectScopes(
  ...scopes: Array<ResourceScope | undefined>
): ScopeConstraint | undefined {
  const defined = scopes.filter((scope): scope is ResourceScope => scope !== undefined);
  if (defined.length === 0) return undefined;

  const restricted = defined.filter((scope) => !scope.unrestricted || scope.ownOnly);
  if (restricted.length === 0) return defined[0];
  if (restricted.length === 1) return restricted[0];
  return { kind: 'intersection', scopes: restricted };
}

/**
 * Translate an effective resource scope into a fail-closed SQL predicate.
 * Callers provide the columns for the rows they are selecting, including
 * COALESCE expressions when an outer join can leave a dimension nullable.
 */
export function scopePredicate(
  scope: ScopeConstraint | undefined,
  columns: ScopeSqlColumns,
): SQL {
  if (!scope) return sql`true`;

  if (isScopeIntersection(scope)) {
    return sql`(${sql.join(
      scope.scopes.map((member) => scopePredicate(member, columns)),
      sql` AND `,
    )})`;
  }

  if (scope.ownOnly && !columns.owner) return sql`false`;

  if (scope.unrestricted) return sql`true`;

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

export function globalOnlyPredicate(scope: ScopeConstraint | undefined): SQL {
  if (scope && isScopeIntersection(scope)) {
    return scope.scopes.every((member) => member.unrestricted && !member.ownOnly)
      ? sql`true`
      : sql`false`;
  }
  return !scope || (scope.unrestricted && !scope.ownOnly) ? sql`true` : sql`false`;
}
