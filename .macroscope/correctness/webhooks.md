---
include:
  - "apps/api/src/modules/**"
  - "packages/db/src/schema/webhooks.ts"
---

**Webhook delivery invariants.**

- Outbound payloads are HMAC-signed with the endpoint's secret. Any code path that sends unsigned payloads or signs after serialization changes is a bug.
- Delivery is at-least-once. Consumers are expected to dedupe; never add logic that assumes exactly-once delivery.
- Retries back off and eventually park the event. Flag retry loops without bounded attempts or without recording final failure state.
- Event payload shapes are part of the public contract. Breaking changes to an emitted event's fields need a version bump or additive-only change.
