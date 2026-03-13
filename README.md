# BetterSpend

**Open-source Procure-to-Pay management for teams that need control over their procurement stack.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org)
[![NestJS](https://img.shields.io/badge/NestJS-10-red)](https://nestjs.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue)](https://postgresql.org)

<!-- Screenshot: Dashboard overview -->

---

## Why BetterSpend?

Most procurement tools are per-seat SaaS products that cost thousands of dollars a month and lock your spend data behind a vendor. BetterSpend is a self-hosted, open-source alternative to Procurify and Coupa — giving you the full Procure-to-Pay workflow, a configurable approval engine, and GL integrations without recurring licensing fees.

---

## Feature Highlights

- **Full Procure-to-Pay** — purchase requisitions flow through approvals into POs, then to goods receipts and invoice matching
- **Configurable Approval Engine** — build multi-step approval chains with no-code condition rules; priority-ordered, delegation-aware
- **3-Way Invoice Matching** — automatic line-level matching across PO, GRN, and invoice with tolerance controls and exception handling
- **Budget Control** — real-time budget availability checks gate PO issuance before money is committed
- **Vendor & Contract Management** — vendor master, contract lifecycle tracking, compliance alerts, and a tokenized vendor portal for invoice submission
- **Spend Intelligence** — analytics dashboards, anomaly detection, and GL export to QuickBooks Online and Xero
- **Catalog & RFQ** — internal product catalog, Punchout (cXML), and RFQ/quote comparison workflow
- **Audit-Ready** — every mutation is recorded in an immutable, append-only audit trail

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Monorepo | Turborepo + pnpm workspaces |
| Backend | NestJS v10 (TypeScript) |
| Frontend | Next.js 15 App Router |
| ORM | Drizzle ORM |
| Database | PostgreSQL 16 |
| Auth | better-auth |
| Queue | BullMQ + Redis |
| File Storage | S3-compatible (MinIO for dev, S3/R2 for prod) |
| UI | shadcn/ui + Tailwind CSS |
| Validation | Zod (shared between API and frontend) |

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+
- pnpm (`wget -qO- https://get.pnpm.io/install.sh | bash`)

### 1. Clone and install

```bash
git clone https://github.com/AsyncronousVentures/betterspend.git
cd betterspend
cp .env.example .env
pnpm install
```

### 2. Start infrastructure

```bash
docker compose up -d
# Starts: PostgreSQL 16, Redis 7, MinIO
```

### 3. Set up the database

```bash
pnpm db:migrate    # Apply all schema migrations
pnpm db:seed       # Load demo data (Acme Corp org, departments, vendors)
```

> **Note on demo accounts:** The seed creates user records (`admin@acme.com`, `requester@acme.com`, `approver@acme.com`) but does not set passwords. Visit `http://localhost:3100/signup` to create your account, then use Drizzle Studio or the API to assign it to the Acme Corp org if needed.

### 4. Start the app

```bash
pnpm dev
```

### 5. Open the app

| Service | URL |
|---------|-----|
| Web UI | http://localhost:3100 |
| API | http://localhost:4001/api/v1 |
| API Docs (Swagger) | http://localhost:4001/api/docs |
| Drizzle Studio | http://localhost:4983 (`pnpm db:studio`) |
| MinIO Console | http://localhost:9001 (minioadmin / minioadmin) |

---

## Project Structure

```
betterspend/
├── apps/
│   ├── api/               NestJS backend
│   │   └── src/
│   │       ├── common/    Decorators, interceptors, shared services
│   │       └── modules/   Feature modules (one per domain)
│   └── web/               Next.js 15 frontend
│       └── src/
│           ├── app/       App Router pages
│           ├── components/ Shared UI components
│           └── lib/       API client, theme, utilities
├── packages/
│   ├── db/                Drizzle schema, migrations, seed
│   ├── shared/            Zod schemas, TypeScript types, constants
│   ├── ui/                Shared React component library
│   └── config/            Shared ESLint, TS, Tailwind configs
├── docker-compose.yml
├── ecosystem.config.js    pm2 process config (production)
└── turbo.json
```

---

## Development Commands

```bash
pnpm dev              # Start api + web in development mode
pnpm build            # Build all packages and apps
pnpm typecheck        # TypeScript check all packages
pnpm lint             # ESLint all packages
pnpm format           # Prettier format all files

pnpm db:generate      # Generate Drizzle migrations from schema changes
pnpm db:migrate       # Run pending migrations
pnpm db:seed          # Seed demo data
pnpm db:studio        # Open Drizzle Studio (visual DB browser)
```

---

## Contributing

Contributions are welcome. The backlog lives in [GitHub Issues](https://github.com/AsyncronousVentures/betterspend/issues) and the project board at [AsyncronousVentures/projects/1](https://github.com/orgs/AsyncronousVentures/projects/1).

**Workflow:** fork → feature branch → pull request against `main`.

**Code conventions:**
- TypeScript strict mode throughout
- Zod validation at all system boundaries (API request bodies, external responses)
- Drizzle ORM for all DB access — no raw SQL except migrations
- See `CLAUDE.md` for dev setup nuances, pm2 process management, and port configuration

---

## Roadmap

Active development (tracking in GitHub Issues):

- **Notifications center** — in-app and email alerts for approval requests and status changes
- **Inventory tracking** — stock levels, reorder points, PO auto-generation
- **Mobile-friendly UI** — responsive polish for receiving and approval workflows

Planned:

- SSO / OIDC / SAML (better-auth enterprise providers)
- Vendor scorecards and compliance tracking
- Advanced spend analytics and anomaly alerting
- Multi-currency support

---

## License

MIT
