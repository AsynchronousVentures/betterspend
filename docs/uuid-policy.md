# UUID policy

BetterSpend uses RFC-compatible version 4 UUIDs for persistent identities.
Schema UUID primary keys use PostgreSQL `gen_random_uuid()` defaults. Seeded
workload rows use deterministic version 4 UUIDs so a named seed can be repaired
without changing its graph. Neither path uses fixed or incrementing UUID
values.

The ordinary demo seed resolves Acme Corp by `slug`, the demo users by email,
departments by code, the parent legal entity by code, and vendors by code. It
returns those database-generated IDs to the random workload generator. API
demo mode uses the same organization slug and administrator email lookup; it
does not carry a primary-key constant.

The UUID migration history contains a guarded upgrade for installations made
with the old incremental demo IDs. It maps the known organization, identity,
department, entity, vendor, and role rows to fresh UUIDs, rewrites scalar and
composite references plus JSON/text metadata, and removes only the old
identity rows. It is a no-op when the legacy organization is absent and aborts
when a recognized legacy row no longer has its expected natural key.

Shared API schemas validate UUIDs with the strict RFC-compatible Zod check.
