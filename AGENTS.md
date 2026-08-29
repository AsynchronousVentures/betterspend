# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Project

BetterSpend is a single-tenant, open-source **Purchase Order Management** system covering the full Procure-to-Pay lifecycle. It rivals Procurify and Odoo with immutable audit trails, a dynamic approval engine, 3-way invoice matching, and GL export integrations.

## Setup & Commands

### Prerequisites

- Docker & Docker Compose
- Node.js 22
- pnpm (`wget -qO- https://get.pnpm.io/install.sh | bash`)

### Environment

```bash
cp .env.example .env          # copy and customize
```

### Infrastructure (PostgreSQL, Redis, MinIO)

```bash
docker compose up -d          # start all infrastructure services
docker compose down           # stop infrastructure
docker compose logs -f        # tail logs
```

### Dependencies

```bash
pnpm install                  # install all workspace deps
```

### Production Deployment (Docker Compose)

Production runs from immutable GHCR images under `/opt/betterspend`. The app process manager is Docker Compose, not pm2. Runtime and packaging changes pushed to `main` publish only `sha-<full-sha>` images; documentation and agent-metadata-only pushes do not publish images. A validated `vX.Y.Z` release ensures those SHA manifests exist, then promotes them to `vX.Y.Z` and `latest`.

```bash
cd /opt/betterspend
export IMAGE_TAG="$(cat .current_image_tag)"
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml ps
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml logs -f api web caddy
./deploy/deploy.sh sha-<commit>           # deploy an immutable image tag for exact testing
./deploy/deploy.sh v0.2.3                 # deploy a version-tagged release
./deploy/rollback.sh                      # roll back the image and displayed version together
```

GitHub Actions publishes immutable `sha-<commit>` images for runtime and packaging changes merged to `main`. Pushing a valid `vX.Y.Z` tag builds any missing exact-commit SHA images after full validation, promotes the manifests to the matching version and `latest`, then (once deploy secrets are configured) deploys the version tag to production through the protected `production` environment. The deployment requires `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY`, and pinned-host `DEPLOY_SSH_KNOWN_HOSTS` secrets; without them the deploy job is skipped. Server secrets stay in `/opt/betterspend/.env.production`; CI syncs only the explicit Compose and deployment file list and passes the validated version tag.

`APP_VERSION` is injected into the API and web containers. Version tags display without their leading `v`; manual `sha-*` deploys display the SHA tag. When `APP_VERSION` is unset, both services use the synchronized package version. Rollback derives the same value from the selected image tag. After advancing every workspace package version together, use `pnpm release:tag 0.2.4` from a clean, current `main` checkout to validate them and create the matching annotated tag, then push that tag manually.

To roll back a bad release, run `./deploy/rollback.sh` on the server to switch the application image only; it does not roll back database migrations or restore the pre-migration backup, so restore the database separately when required (or re-tag an earlier commit).

### Development (local)

#### Database

```bash
pnpm db:generate              # generate Drizzle migrations from schema changes
pnpm db:migrate               # run pending migrations
pnpm db:seed                  # seed demo data (Acme Corp org, users, vendors)
pnpm db:studio                # open Drizzle Studio at http://localhost:4983
```

### Build & Quality

```bash
pnpm build                    # build all packages and apps
pnpm typecheck                # TypeScript check all packages
pnpm lint                     # lint all packages
pnpm test                     # run all tests
pnpm format                   # format with Prettier
pnpm ci:preflight             # run the required local checks before pushing
pnpm ci:preflight:docker      # also build all production images locally
```

### Access Points

- Web UI: http://localhost:3100
- API: http://localhost:4001/api/v1
- API Docs (Swagger): http://localhost:4001/api/docs
- Drizzle Studio: http://localhost:4983
- MinIO Console: http://localhost:9001 (minioadmin / minioadmin)

## Architecture

### Tech Stack

| Layer        | Technology                            |
| ------------ | ------------------------------------- |
| Monorepo     | Turborepo + pnpm workspaces           |
| Backend      | NestJS v10 (TypeScript)               |
| Frontend     | Next.js 16 App Router                 |
| ORM          | Drizzle ORM                           |
| Database     | PostgreSQL 18                         |
| Auth         | better-auth                           |
| Queue        | BullMQ + Redis                        |
| File Storage | S3-compatible (MinIO dev, S3/R2 prod) |
| UI           | shadcn/ui + Tailwind CSS              |
| Validation   | Zod (shared between API and frontend) |

### Monorepo Structure

```
apps/
  api/          NestJS backend — modules in src/modules/
  web/          Next.js frontend — pages in src/app/
packages/
  db/           Drizzle schema, relations, client, migrations, seed
  shared/       Zod schemas, TypeScript types, constants (ROLES, PO_STATUS, etc.)
  ui/           Shared React component library (shadcn-based)
  config/       Shared ESLint, TS, Tailwind configs
```

### API

- Base prefix: `/api/v1`
- REST + OpenAPI 3.1 (auto-generated by `@nestjs/swagger`)
- Communication: JSON over HTTP, Bearer token auth

### Database

- Schema source of truth: `packages/db/src/schema/`
- One file per domain: organizations, users, vendors, requisitions, approvals, purchase-orders, receiving, invoices, budgets, audit, documents, sequences, webhooks
- Relations: `packages/db/src/relations.ts`
- Audit log is append-only (no UPDATE/DELETE)

### Key Domains

1. **Requisitions** → Approval Engine → **Purchase Orders** (with versioning/change orders)
2. **Receiving** (GRN) + **Invoices** → 3-Way Match → AP approval
3. **Budgets** — department/project/GL account budget tracking with approval gates
4. **Webhooks** — outbound event delivery with HMAC signing and retry
5. **Integrations** — GL export (QuickBooks, Xero)

### User Roles

`admin` | `approver` | `requester` | `receiver` | `finance`

Roles can be scoped: `global`, `department`, or `project`.

### Approval Engine

- Rules stored as JSONB condition expressions in `approval_rules`
- Evaluated in priority order; first match wins
- Multi-step sequential chains via `approval_rule_steps`
- All actions are immutable (`approval_actions` — append only)

### Number Sequences

Auto-generated: `REQ-YYYY-NNNN`, `PO-YYYY-NNNN`, `GRN-YYYY-NNNN`, `INV-YYYY-NNNN`
Uses `sequences` table with `SELECT ... FOR UPDATE` for gap-free generation.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (AsynchronousVentures/betterspend), driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

## PR review etiquette

- Follow `docs/agents/pr-review-policy.md`. Open agent-authored pull requests as drafts. After Fast CI passes on the latest head, run `gh pr ready <PR URL>` to start Macroscope. Approvability handles routine approvals, while a human reviews changes Macroscope will not approve.
- Run `pnpm ci:preflight` before the first push. Use `pnpm ci:preflight:docker` to check production images explicitly. The pre-push hook automatically selects the Docker tier when packaging inputs changed.
- CodeRabbit is manual and advisory. Request it only for security, migration, approval, or organization-boundary changes after Macroscope findings are triaged. Request a follow-up only when one of its valid findings caused a material code change.
- After verifying each Macroscope finding, react with 👍 when it was useful or 👎 when it was not. Teach CodeRabbit lasting preferences through a direct `@coderabbitai` reply that explains why; do not turn one-off exceptions into learnings.
- Every review comment on a PR you opened must receive a reply before merge. Each reply either states the commit that addressed it, or states that it is being ignored and why.
- Never merge a PR while a required Macroscope review has `CHANGES_REQUESTED` outstanding, even if other required checks are green. Resolve or explicitly dismiss each thread first, and surface unresolved feedback to Tyler before merging rather than after.
- Use `@coderabbitai resolve` (or resolve threads via the API) once a CodeRabbit comment has been addressed.
