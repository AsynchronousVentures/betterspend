import { sql, type SQL } from 'drizzle-orm';
import type { ResourceScope } from '@betterspend/shared';

/** Select eligible IDs before loading actions, rules, or entity summaries. */
export function pendingApprovalQuery(
  organizationId: string,
  actorId: string,
  scope: ResourceScope | undefined,
  page: number,
  limit: number,
  includeDelegations: boolean,
): SQL {
  const department = sql`COALESCE(r.department_id, pr.department_id)`;
  const project = sql`COALESCE(r.project_id, pr.project_id)`;
  const entity = sql`CASE WHEN ar.approvable_type = 'purchase_order' THEN po.entity_id
    WHEN ar.approvable_type = 'invoice' THEN i.entity_id END`;
  const dimensions = scope
    ? [
        ...scope.departmentIds.map((id) => sql`${department} = ${id}`),
        ...scope.projectIds.map((id) => sql`${project} = ${id}`),
        ...scope.entityIds.map((id) => sql`${entity} = ${id}`),
      ]
    : [];
  // Mirrors scopeAllowsApproval: the assigned actor must also hold a matching read grant.
  const permission =
    !scope || scope.unrestricted
      ? sql`true`
      : dimensions.length
        ? sql`(${sql.join(dimensions, sql` OR `)})`
        : sql`false`;
  return sql`
    WITH active_delegators AS MATERIALIZED (
      SELECT DISTINCT d.delegator_id FROM approval_delegations d
      WHERE d.organization_id = ${organizationId} AND d.delegate_id = ${actorId}
        AND d.is_active = true AND d.start_date <= NOW() AND d.end_date >= NOW()
        AND ${includeDelegations}
    )
    SELECT ar.id
    FROM approval_requests ar
    JOIN users actor ON actor.id = ${actorId} AND actor.organization_id = ${organizationId}
    LEFT JOIN LATERAL (
      SELECT steps.* FROM approval_rule_steps steps
      JOIN approval_rules rules ON rules.id = steps.approval_rule_id
        AND rules.organization_id = ar.organization_id
      WHERE steps.approval_rule_id = ar.approval_rule_id AND steps.step_order = ar.current_step
      ORDER BY steps.id LIMIT 1
    ) step ON true
    LEFT JOIN requisitions r ON ar.approvable_type = 'requisition' AND r.id = ar.approvable_id
      AND r.organization_id = ar.organization_id
    LEFT JOIN purchase_orders po ON ar.approvable_type = 'purchase_order' AND po.id = ar.approvable_id
      AND po.organization_id = ar.organization_id
    LEFT JOIN invoices i ON ar.approvable_type = 'invoice' AND i.id = ar.approvable_id
      AND i.organization_id = ar.organization_id
    LEFT JOIN purchase_orders ipo ON ipo.id = i.purchase_order_id AND ipo.organization_id = ar.organization_id
    LEFT JOIN requisitions pr ON pr.id = COALESCE(po.requisition_id, ipo.requisition_id)
      AND pr.organization_id = ar.organization_id
    WHERE ar.organization_id = ${organizationId} AND ar.status = 'pending'
      AND ${permission}
      AND (
        ar.required_approver_id = ${actorId} OR step.approver_id = ${actorId}
        OR ar.required_approver_id IN (SELECT delegator_id FROM active_delegators)
        OR step.approver_id IN (SELECT delegator_id FROM active_delegators)
        OR EXISTS (
          SELECT 1 FROM user_roles assignment
          WHERE assignment.user_id = ${actorId}
            AND assignment.role = CASE WHEN step.approver_type = 'role' THEN step.approver_role
              WHEN step.approver_type = 'department_head' THEN 'approver' END
            AND (
              assignment.scope_type = 'global'
              OR (assignment.scope_type = 'department' AND assignment.scope_id = ${department})
              OR (step.approver_type <> 'department_head' AND (
                (assignment.scope_type = 'project' AND assignment.scope_id = ${project})
                OR (assignment.scope_type = 'entity' AND assignment.scope_id = ${entity})
              ))
            )
        )
      )
    ORDER BY ar.created_at, ar.id
    LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}
  `;
}
