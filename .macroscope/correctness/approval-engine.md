---
include:
  - "packages/db/src/schema/approvals.ts"
  - "packages/db/src/schema/approval-delegations.ts"
  - "apps/api/src/modules/approvals/**"
  - "apps/api/src/modules/approval-rules/**"
  - "apps/api/src/modules/approval-delegations/**"
---

**Approval engine invariants.**

- Rules are evaluated in priority order and the first match wins. Never introduce logic that evaluates multiple matching rules or reorders evaluation as a side effect.
- Approval chains are multi-step and sequential via `approval_rule_steps`. Steps must complete in order; never allow a later step to be satisfied while an earlier one is pending.
- `approval_actions` is append-only. Any code path that UPDATEs or DELETEs from it is a bug, even for "fixing" bad state. Corrections are new rows.
- Rule conditions are stored as JSONB expressions. When changing the expression shape, keep reads tolerant of previously stored shapes or write an explicit migration. Silent misinterpretation of an old condition is worse than a crash.
- Approval state transitions must be idempotent at the API layer: duplicate approve/reject submissions must not double-fire notifications, delegations, or downstream PO creation.
