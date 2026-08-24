---
include:
  - "packages/db/src/schema/**"
  - "packages/shared/src/**"
  - "apps/api/**"
  - "apps/web/**"
exclude:
  - "**/*.test.ts"
  - "**/*.spec.ts"
---

**Money and validation rules.**

- Currency amounts live in numeric/decimal columns and are handled as strings or decimal types end to end. Flag any conversion of a monetary value through `Number()` arithmetic beyond simple display formatting, float columns, or float literals.
- Currency math (totals, tax, 3-way match variance) must define its rounding rule explicitly. Silent default rounding is a bug.
- Zod schemas are the single source of truth and live in `packages/shared`. Flag request DTOs or form state that re-validates with hand-rolled checks instead of reusing the shared schema, and flag divergent copies of the same shape between API and web.
- Multi-currency amounts carry their currency code alongside the amount; a bare amount field without currency context in a stored record is suspect.
