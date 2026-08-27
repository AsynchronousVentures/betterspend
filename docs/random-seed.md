# Local random workload seed

BetterSpend has two local seed paths:

```bash
pnpm db:seed
pnpm db:seed:random -- --count 500 --seed 42
```

The normal command loads the small Acme Corp fixture used by demo mode. It resolves the organization, users, departments, entity, roles, and vendors through natural keys, then keeps their database-generated UUIDs on reruns. The random command is opt-in, development-only, resolves that identity first, and carries the returned IDs through the generated workload so demo-mode requests can see it.

## Options and safety

`--count` is the number of purchase-to-pay stories. It must be an integer from 1 through 5000, with a default of 500. `--seed` is any non-empty string up to 120 characters, with a fixed default. Unknown flags and missing or malformed values fail before a database write. The random path refuses to run when `NODE_ENV=production`, never prints `DATABASE_URL`, and does not truncate any table.

The graph is generated from deterministic RFC-compatible version 4 IDs, business numbers, timestamps, values, and fake contact metadata. Persistent fixture IDs come from PostgreSQL defaults, not from the generator. Webhook signing secrets and the inbound email address token are deliberate exceptions, generated with cryptographic randomness at first persistence and never printed. The same seed and count can be rerun safely because conflict-safe inserts preserve existing secrets and tokens. A durable `system_settings` marker stores the metadata schema version and original count under the full seed digest. A seed namespace may only be rerun with the count recorded by its first successful run. On the first run without a marker, the existing requisition prefix is checked before writing for compatibility with older seeds. Once the marker exists, its count is authoritative, so a rerun can repair deleted deterministic rows. A count mismatch fails without changing the database. Choose a new seed when you need a different count.

At the default count of 500, expect roughly 7,000 to 8,000 rows across the covered tables, depending on lifecycle proportions. Generation is pure and fast, while persistence uses batches of 200 rows inside one transaction.

## Coverage

Each story has a requisition, deterministic line totals, a lifecycle status, and supporting links where that status permits. Approved stories continue into purchase orders, PO versions and blanket releases, receipts, invoices, invoice lines, 3-way match results, budget commitment events, payment runs, GL export jobs, notifications, messages, and audit entries. The generator also creates proportionate support rows for legal entities, departments, projects, users and scoped roles, vendors, catalog, tax and exchange rates, approval rules and steps, budgets, RFQs, contracts and intelligence metadata, inventory, recurring POs, requisition templates, vendor onboarding, payment metadata, price proposals, software licenses, spend alerts, disabled webhooks, email intake, procurement policies, concierge sessions, sanctions screenings, and revoked integration sync metadata.

Generated emails, URLs, storage keys, account masks, provider IDs, and payment metadata are fake and inert. The webhook endpoint is inactive and points at `example.invalid`. The integration connection is revoked, has no encrypted token values, and produces skipped sync records only.

The seed deliberately excludes auth sessions, OAuth accounts, verification records, password reset tokens, vendor portal tokens and sessions, AI provider credentials and OAuth state, active integrations or external secrets, workflow runtime rows, and sanctions registry state or entries. These tables either hold secrets or transient security state, or require runtime invariants that a static fixture cannot represent honestly.
