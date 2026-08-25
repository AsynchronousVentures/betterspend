# BetterSpend

**Open-source, self-hosted procure-to-pay management.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org)
[![NestJS](https://img.shields.io/badge/NestJS-11-red)](https://nestjs.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-blue)](https://postgresql.org)

BetterSpend covers purchasing from intake through payment while keeping the application, infrastructure, and spend data under your control.

## What BetterSpend covers

- **Intake and purchasing:** guided intake, requisitions, reusable templates, catalogs, purchase orders, change orders, recurring POs, and receiving
- **Approvals and controls:** condition-based approval workflows, sequential approval steps, delegations, workflow simulation, scoped roles, and budget enforcement
- **Invoices and accounts payable:** invoice intake by upload or email, OCR-assisted entry, line-level 3-way matching, exception review, AP aging, and payment runs
- **Suppliers and sourcing:** vendor onboarding questionnaires, a secure vendor portal, contracts, RFQs and quote comparison, punchout catalogs, supplier scorecards, diversity tracking, compliance, and risk screening
- **Accounting:** legal entities, tax codes, currencies and exchange rates, GL mappings, and exports to QuickBooks Online and Xero
- **Operations and reporting:** inventory, software license renewals, notifications, global search, spend analytics, CSV reports, and signed outbound webhooks with retries
- **Audit and security:** better-auth sessions, role-based access, encrypted accounting and AI credentials, and an append-only audit log

Some integrations require provider credentials or external services. The core local stack includes PostgreSQL, Redis, and MinIO.

## Tech stack

| Layer          | Technology                                               |
| -------------- | -------------------------------------------------------- |
| Monorepo       | Turborepo 2 + pnpm 10 workspaces                         |
| API            | NestJS 11, TypeScript 5.7, OpenAPI                       |
| Web            | Next.js 15 App Router, React 19, TanStack Query          |
| Database       | PostgreSQL 18, Drizzle ORM                               |
| Auth           | better-auth with organization-scoped roles               |
| Validation     | Zod 4 shared schemas and Nest validation pipes           |
| Jobs           | BullMQ + Redis 7                                         |
| Object storage | S3-compatible storage, with MinIO in the reference stack |
| UI             | Tailwind CSS 4, Radix UI primitives, Lucide, Recharts    |
| Deployment     | Docker Compose, Caddy, GHCR images, GitHub Actions       |

## Local development

This path runs PostgreSQL, Redis, and MinIO in Docker while the API and web app run through pnpm with hot reload.

### Prerequisites

- Docker Engine with the Docker Compose plugin
- Node.js 22
- pnpm 10.15.1, as pinned by `packageManager` in `package.json`
- OpenSSL, used to generate local encryption keys

### 1. Clone and configure

```bash
git clone https://github.com/AsynchronousVentures/betterspend.git
cd betterspend
corepack enable
pnpm install
cp .env.example .env
openssl rand -base64 32
```

Paste the generated value into `CREDENTIAL_ENCRYPTION_KEY` in `.env`. Keep the same value while using the database because stored integration credentials are encrypted with it.

The root `.env` is shared by the workspace but is not loaded automatically by every package command. Load it in each new shell:

```bash
set -a
. ./.env
set +a
```

For passwordless access as the seeded local admin, set `DEMO_MODE=true` in `.env` before loading it. Demo mode is rejected when `NODE_ENV=production`.

### 2. Start local infrastructure

```bash
docker compose up -d
docker compose ps
```

This starts PostgreSQL on port 5433, Redis on 6379, and MinIO on 9000 and 9001. The named volumes keep local data between restarts.

If this checkout has an old or incompatible local PostgreSQL volume, recreate all local data once:

```bash
docker compose down -v
docker compose up -d
```

This deletes the local PostgreSQL, Redis, and MinIO volumes.

### 3. Prepare the database

```bash
pnpm db:migrate
pnpm db:seed
```

The seed creates the Acme Corp organization, two departments, three users, and sample vendors. The user rows do not have passwords. Use local demo mode for the shortest path, or leave it disabled when testing the real sign-up and session flow.

### 4. Run the app

```bash
pnpm dev -- --env-mode=loose
```

Loose environment mode passes the values loaded from the root `.env` through Turborepo to both development servers.

| Service        | Local URL                                               |
| -------------- | ------------------------------------------------------- |
| Web UI         | http://localhost:3000                                   |
| API            | http://localhost:4001/api/v1                            |
| API docs       | http://localhost:4001/api/docs                          |
| Drizzle Studio | http://localhost:4983 after `pnpm db:studio`            |
| MinIO console  | http://localhost:9001 using `minioadmin` / `minioadmin` |

Stop the application with Ctrl+C. Stop local infrastructure with `docker compose down`.

### Run application containers locally

Use this path to test production builds locally. It still uses the development credentials and exposed infrastructure ports from `compose.override.yaml`.

```bash
docker compose --profile tools run --rm migrator
pnpm db:seed
docker compose --profile app up --build
```

The containerized web UI is at http://localhost:3100. The API remains at http://localhost:4001. Application containers set `NODE_ENV=production`, so `DEMO_MODE` must remain false for this path.

## Production deployment

Production uses immutable API, web, and migrator images from GHCR. It combines `compose.yaml` with `compose.prod.yaml`; do not use `compose.override.yaml` or a bare `docker compose up` on a production host.

The included reference deployment runs Caddy as the only public service. Caddy terminates TLS, sends `/api/*` to the API, sends all other application traffic to Next.js, and exposes MinIO at `files.<your-domain>`. PostgreSQL, Redis, MinIO, the API, and the web container stay on the private Compose network.

### First server setup

1. Install Docker Engine and the Docker Compose plugin on the server.
2. Point the application domain and `files.<your-domain>` at the server.
3. Copy `compose.yaml`, `compose.prod.yaml`, `.env.production.example`, and `deploy/` to `/opt/betterspend`.
4. Copy `.env.production.example` to `/opt/betterspend/.env.production` and replace every example domain, image name, password, secret, and encryption key.
5. Log in to GHCR on the server if the images are private.

Deploy an immutable image set by commit SHA:

```bash
cd /opt/betterspend
./deploy/deploy.sh sha-<commit>
```

The script pulls all three images, starts stateful services, waits for PostgreSQL, writes a compressed database backup, runs forward-only migrations, starts the application, and checks the public health and web endpoints.

A fresh production database still needs organization and first-admin provisioning. The deployment script intentionally does not load the Acme demo seed.

### Automated releases

Every merge to `main` publishes immutable `sha-<commit>` images and updates the `latest` aliases. Pushing a `v*` tag publishes the same immutable images and deploys that commit when the protected `production` environment and `DEPLOY_SSH_*` secrets are configured. If the secrets are absent, publishing succeeds and deployment is skipped.

See [Production deployment](docs/deployment.md) for the ingress contract, GitHub configuration, manual operations, backups, recovery, and rollback behavior.

## Workspace layout

```text
apps/
  api/       NestJS API and domain modules
  web/       Next.js application
packages/
  db/        Drizzle schema, migrations, database client, and seed
  shared/    Shared Zod schemas, types, and constants
docker/      API, web, and migrator image definitions
deploy/      Caddy config and deployment/rollback scripts
```

## Common commands

```bash
pnpm dev -- --env-mode=loose  # Run API and web with the loaded local environment
pnpm build            # Build all packages and apps
pnpm typecheck        # TypeScript checks
pnpm lint             # ESLint checks
pnpm test             # Test suites
pnpm format           # Format supported files with Prettier

pnpm db:generate      # Generate a migration from schema changes
pnpm db:migrate       # Apply pending migrations
pnpm db:seed          # Reset and load the local demo organization
pnpm db:studio        # Open Drizzle Studio
```

Load `.env` into the shell before database commands. Read [Database migrations](docs/database-migrations.md) before creating or resolving a schema change.

## Contributing

The backlog lives in [GitHub Issues](https://github.com/AsynchronousVentures/betterspend/issues) and the [project board](https://github.com/orgs/AsynchronousVentures/projects/1). Open pull requests against `main`.

The codebase uses strict TypeScript, shared Zod schemas at system boundaries, and Drizzle for database access. Run lint, tests, type checks, and builds before submitting a change.

## License

[MIT](LICENSE)
