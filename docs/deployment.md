# Dockerized BetterSpend deployment

The published API, web, and migrator images are infrastructure-neutral. The web image sends API requests to its own origin, so the same immutable image can run on any hostname. The included Compose and Caddy files are a reference deployment, not a requirement.

`compose.yaml` owns the infrastructure shared with local development. `compose.prod.yaml` adds the production application images, Caddy, secrets, persistence settings, and restart policies. Production commands always load both files in that order.

## Ingress contract

Any reverse proxy or ingress controller can run BetterSpend when it preserves this routing contract:

- Send `/api/*` on the public app origin to the API container on port `4001`. Do not strip the `/api` prefix.
- Send all other paths on the public app origin to the web container on port `3000`.
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

3. Copy `compose.yaml`, `compose.prod.yaml`, and `deploy/` into `/opt/betterspend`, preserving the `deploy/` directory.
4. Create `/opt/betterspend/.env.production` from `.env.production.example`.
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

The validation job runs for pull requests, pushes to `main`, and `v*` tags. Pushes to `main` publish application images to GHCR after validation succeeds. A `v*` tag publishes the same immutable images and deploys them to production when the deployment secrets below are configured.

Repository variables:

- `GHCR_IMAGE_NAMESPACE`: optional image namespace for pushed images. Defaults to the lowercased repository owner.

Repository secrets for automated tag deployments:

- `DEPLOY_SSH_HOST`: production SSH host.
- `DEPLOY_SSH_USER`: production SSH user.
- `DEPLOY_SSH_KEY`: private key for the production host.
- `DEPLOY_SSH_KNOWN_HOSTS`: pinned `known_hosts` entry for the production host.

Configure the `production` GitHub environment for any required approval rules. If the deployment secrets are absent, validation and publishing still run, but the deploy job is skipped. If GHCR packages are private, configure pull credentials on the server or local machine that pulls the images.

## Publish flow

Pull requests run install, typecheck, builds, compose validation, and Docker image builds. They do not deploy.

Pushes to `main` always run the same validation, then publish these images to GHCR:

```text
ghcr.io/<namespace>/betterspend-api:sha-<commit>
ghcr.io/<namespace>/betterspend-web:sha-<commit>
ghcr.io/<namespace>/betterspend-migrator:sha-<commit>
```

After all three immutable images are available, a `main` push also moves each image's `latest` alias to that commit. Release tag workflows do not update `latest`, so tagging an older commit cannot move the aliases backward.

Pushing a `v*` tag runs validation, publishes the immutable `sha-<commit>` images, synchronizes the explicit deployment file list to `/opt/betterspend`, and invokes `./deploy/deploy.sh sha-<commit>` over SSH. Publish jobs for the same commit are serialized, and the workflow skips any image tag that already exists rather than overwriting it. Registry administrators must preserve that `sha-*` immutability convention for any out-of-band operations. The deploy script backs up PostgreSQL, runs migrations, restarts the application containers, and smoke-checks production. Deployments are serialized by the workflow's production concurrency group.

Tag-driven deployment never synchronizes `.env.production` and does not use `rsync --delete`; production secrets remain server-side.

## Manual operations

Deploy a known image tag manually (for example, when automated deployment is not configured):

```bash
cd /opt/betterspend
./deploy/deploy.sh sha-<commit>
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
