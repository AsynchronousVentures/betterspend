# Production deployment

The published API, web, and migrator images are infrastructure-neutral. The web image sends API requests to its own origin, so the same immutable image can run on any hostname. The included Compose and Caddy files are a reference deployment, not a requirement.

`compose.yaml` owns the infrastructure shared with local development. `compose.prod.yaml` adds the production application images, Caddy, secrets, persistence settings, and restart policies. Production commands always load both files in that order.

Do not run a bare `docker compose up` in production. Without both explicit `-f` arguments, Compose may load the development override and publish stateful service ports. The `deploy/deploy.sh` and `deploy/rollback.sh` scripts assemble the production files correctly.

## Ingress contract

Any reverse proxy or ingress controller can run BetterSpend when it preserves this routing contract:

- Send `/api/*` on the public app origin to the API container on port `4001`. Do not strip the `/api` prefix.
- Send all other paths on the public app origin to the web container on port `3000`.
- Preserve `/runtime-version` as a web route. The web client uses it to read the container's runtime release value.
- Forward the original host and protocol headers.
- Expose the configured S3-compatible public endpoint without rewriting signed request paths. A separate object-storage hostname is the simplest setup.

Set `API_URL` and `WEB_URL` to the public app origin at runtime. Set `MINIO_PUBLIC_ENDPOINT` (or `S3_PUBLIC_ENDPOINT`) to the browser-reachable object-storage origin. The application images require no Caddy-specific labels or networks.

The official web image assumes the ingress contract above and contains no deployment hostname. A custom build may set the `NEXT_PUBLIC_API_URL` Docker build argument when the API must live on another origin:

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
  -f docker/web.Dockerfile \
  -t betterspend-web:custom .
```

`NEXT_PUBLIC_API_URL` is compiled by Next.js. Setting it on an already-built container has no effect.

## Reference architecture

- `caddy` listens on public ports `80` and `443`, obtains TLS certificates, routes `/api/*` to the Nest API, routes the web UI to Next.js, and routes `files.<domain>` to MinIO for signed object downloads.
- `api` runs the built NestJS app on internal port `4001`.
- `web` runs the Next.js standalone server on internal port `3000`.
- `migrator` is a one-shot Drizzle migration image.
- `postgres`, `redis`, and `minio` are private Docker services with named volumes and no public host ports.

## Server bootstrap

1. Install Docker Engine and the Docker Compose plugin on the VPS.
2. Create the deployment directory:

```bash
sudo mkdir -p /opt/betterspend
sudo chown "$USER":"$USER" /opt/betterspend
```

3. Copy `compose.yaml`, `compose.prod.yaml`, `.env.production.example`, and `deploy/` into `/opt/betterspend`, preserving the `deploy/` directory.
4. Create `/opt/betterspend/.env.production` from `.env.production.example`. Replace every example domain, image name, password, secret, and encryption key before continuing. Keep this file only on the server.
5. Point DNS records at the VPS:

```text
example.com        A/AAAA -> VPS
files.example.com  A/AAAA -> VPS
```

6. If GHCR packages are private, log in on the server:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
```

## Required GitHub configuration

The validation job runs for pull requests, pushes to `main`, and `v*` tags. Runtime and packaging changes pushed to `main` publish immutable SHA images to GHCR after validation succeeds. Documentation and agent-metadata-only pushes stop after validation without publishing images. A strict `vX.Y.Z` tag ensures the exact commit's SHA manifests exist, promotes them to that version and `latest`, then deploys the version tag when the deployment secrets below are configured.

Repository variables:

- `GHCR_IMAGE_NAMESPACE`: optional image namespace for pushed images. Defaults to the lowercased repository owner.

Repository secrets for automated tag deployments:

- `DEPLOY_SSH_HOST`: production SSH host.
- `DEPLOY_SSH_USER`: production SSH user.
- `DEPLOY_SSH_KEY`: private key for the production host.
- `DEPLOY_SSH_KNOWN_HOSTS`: pinned `known_hosts` entry for the production host.

Configure the `production` GitHub environment for any required approval rules. If the deployment secrets are absent, validation and publishing still run, but the deploy job is skipped. If GHCR packages are private, configure pull credentials on the server or local machine that pulls the images.

## Optional production configuration

QuickBooks Online and Xero connections require platform OAuth applications. Set the matching client ID and secret in `.env.production` and register these exact callbacks with the provider:

```text
https://<app-domain>/api/v1/gl/oauth/qbo/callback
https://<app-domain>/api/v1/gl/oauth/xero/callback
```

The callbacks are derived from `API_URL`. Explicit `QBO_REDIRECT_URI` or `XERO_REDIRECT_URI` values are accepted only when they exactly match the derived URL.

SMTP and AI provider credentials are configured in the authenticated settings and add-ons screens after the first administrator exists. BetterSpend encrypts accounting OAuth tokens and AI provider credentials with `CREDENTIAL_ENCRYPTION_KEY`. Keep that key stable and back it up outside the server.

## Publish and release flow

Runtime-changing pull requests run lint, tests, package builds, type checks, and Compose validation. Pull requests never publish images or deploy. Runtime-changing merge queue groups and pushes to `main`, plus all tags and manual workflow runs, use the full validation path, including migration verification and Docker image builds. Non-runtime changes retain the required `Validate` result without running that expensive path.

Runtime and packaging changes pushed to `main` run full validation, then publish these images to GHCR:

```text
ghcr.io/<namespace>/betterspend-api:sha-<commit>
ghcr.io/<namespace>/betterspend-web:sha-<commit>
ghcr.io/<namespace>/betterspend-migrator:sha-<commit>
```

Main pushes do not move `latest`, and documentation or agent-metadata-only pushes do not publish SHA images. Publish jobs for the same commit are serialized. Pushing a valid `vX.Y.Z` tag checks for all three SHA manifests, briefly retries for registry consistency, then builds any missing exact-commit immutable images after full validation. It promotes each source to both `vX.Y.Z` and `latest` with `docker buildx imagetools create`. Existing version aliases must already match the source manifests, otherwise the release fails instead of moving a published version. The workflow synchronizes the explicit deployment file list to `/opt/betterspend` and invokes `./deploy/deploy.sh vX.Y.Z` over SSH. Registry administrators must preserve `sha-*` immutability.

The deploy script derives `APP_VERSION` from the selected tag unless an explicit value is supplied. It displays `0.2.4` for `v0.2.4` and `sha-<commit>` for an exact SHA deployment. The API and web containers receive the same value. With no runtime override they fall back to the synchronized workspace package version. Rollback always derives the value from the restored image tag, so an inherited shell override cannot make the displayed release stale.

Tag-driven deployment never synchronizes `.env.production` and does not use `rsync --delete`; production secrets remain server-side.

The deploy script does not seed data or create the first organization and administrator. Provision those separately for a new production database. Do not use the Acme development seed as an implicit production bootstrap.

## Manual operations

Deploy a known image tag manually (for example, when automated deployment is not configured):

```bash
cd /opt/betterspend
./deploy/deploy.sh sha-<commit>
```

Deploy a promoted release tag when the exact version is preferred:

```bash
./deploy/deploy.sh v0.2.3
```

Tail logs:

```bash
export IMAGE_TAG="$(cat .current_image_tag)"
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml logs -f api web caddy
```

Run migrations only:

```bash
IMAGE_TAG=sha-<commit> docker compose --profile migrate --env-file .env.production -f compose.yaml -f compose.prod.yaml run --rm migrator
```

Roll back app containers to the previous recorded image tag:

```bash
./deploy/rollback.sh
```

Roll back to a specific tag:

```bash
./deploy/rollback.sh sha-<commit>
```

Prepare a release tag locally with the checked-in guardrails:

```bash
pnpm release:tag 0.2.4
git push origin v0.2.4
```

The command requires a clean `main` checkout and synchronized workspace package versions that match the requested tag. It fetches `origin/main`, verifies `HEAD` against that live remote tip, and refuses an existing local or remote tag. It creates the annotated tag but does not push it. Package versions remain the local fallback and must be advanced deliberately in a release preparation change.

Database migrations are forward-only. The rollback script does not revert schema changes; use the compressed dumps in `/opt/betterspend/backups` for disaster recovery.

## Backups and recovery

Each deploy writes:

```text
/opt/betterspend/backups/postgres-<timestamp>-sha-<commit>.sql.gz
```

Restore into a stopped or isolated database:

```bash
export IMAGE_TAG="$(cat .current_image_tag)"
gunzip -c backups/postgres-<timestamp>-sha-<commit>.sql.gz \
  | docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml exec -T postgres \
      sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

MinIO object data lives in the `minio_data` Docker volume, Postgres data in `postgres_data`, and Redis data in `redis_data`. Back those volumes up separately at the host level if point-in-time disaster recovery matters.

## Production checks

After deploy:

```bash
curl -fsS https://$BETTERSPEND_DOMAIN/api/v1/health
curl -fsS https://$BETTERSPEND_DOMAIN/
export IMAGE_TAG="$(cat .current_image_tag)"
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml ps
```

Postgres, Redis, and MinIO should not have public host port mappings. Only Caddy should expose `80` and `443`.
