---
include:
  - "packages/db/src/schema/audit.ts"
  - "packages/db/src/schema/sequences.ts"
  - "apps/api/src/modules/audit/**"
  - "apps/api/src/modules/export/**"
---

**Audit and sequence invariants.**

- The audit log is append-only: no UPDATE, no DELETE, no upsert that can mutate existing rows. Anything that rewrites history is a critical bug.
- Every mutating business action should produce an audit entry in the same transaction as the mutation. An audit write that can succeed after its source transaction fails (or vice versa) is wrong.
- Number sequences (`REQ-YYYY-NNNN`, `PO-YYYY-NNNN`, `GRN-YYYY-NNNN`, `INV-YYYY-NNNN`) must use `SELECT ... FOR UPDATE` on the sequences row. Flag any generation path that reads the counter without locking or that catches a conflict by retrying with a different number.
- Sequence values are gap-free by design. Do not "optimize" them to skip locks or cache counters in application memory.
