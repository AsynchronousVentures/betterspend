# Dockerized BetterSpend Deployment

This deployment replaces manual `git pull`, host builds, migrations, and pm2 restarts with immutable Docker images and a single Docker Compose project on the VPS.

## Architecture

- `caddy` listens on public ports `80` and `443`, obtains TLS certificates, routes `/api/*` to the Nest API, routes the web UI to Next.js, and routes `files.<domain>` to MinIO for signed object downloads.
- `api` runs the built NestJS app on internal port `4001`.
- `web` runs the Next.js standalone server on internal port `3000`.
- `migrator` is a one-shot Drizzle migration image.
- `postgres`, `redis`, and `minio` are private Docker services with named volumes and no public host ports.

## Server Bootstrap

1. Install Docker Engine and the Docker Compose plugin on the VPS.
2. Create the deployment directory:

```bash
sudo mkdir -p /opt/betterspend
sudo chown "$USER":"$USER" /opt/betterspend
```

3. Copy `deploy/` into `/opt/betterspend`.
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

## Required GitHub Configuration

The validation job runs for pull requests and pushes to `main`. Pushes to `main` publish the application images to GHCR after validation succeeds. The workflow does not update, pull, or restart the server.

Repository variables:

- `GHCR_IMAGE_NAMESPACE`: optional image namespace for pushed images. Defaults to the lowercased repository owner.
- `NEXT_PUBLIC_API_URL`: optional API base URL baked into the web image. Defaults to `http://localhost:4001`.

No repository secrets are required by the publishing workflow. If GHCR packages are private, configure pull credentials on the server or local machine that pulls the images.

## Publish Flow

Pull requests run install, typecheck, builds, compose validation, and Docker image builds. They do not deploy.

Pushes to `main` always run the same validation, then publish these images to GHCR:

```text
ghcr.io/<namespace>/betterspend-api:sha-<commit>
ghcr.io/<namespace>/betterspend-web:sha-<commit>
ghcr.io/<namespace>/betterspend-migrator:sha-<commit>
```

Pulling the image tag, restarting services, running migrations, and smoke-checking production are manual operations.

## Manual Operations

Deploy a known image tag:

```bash
cd /opt/betterspend
./deploy.sh sha-<commit>
```

Tail logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api web caddy
```

Run migrations only:

```bash
IMAGE_TAG=sha-<commit> docker compose --profile migrate --env-file .env.production -f docker-compose.prod.yml run --rm migrator
```

Roll back app containers to the previous recorded image tag:

```bash
./rollback.sh
```

Roll back to a specific tag:

```bash
./rollback.sh sha-<commit>
```

Database migrations are forward-only. The rollback script does not revert schema changes; use the compressed dumps in `/opt/betterspend/backups` for disaster recovery.

## Backups And Recovery

Each deploy writes:

```text
/opt/betterspend/backups/postgres-<timestamp>-sha-<commit>.sql.gz
```

Restore into a stopped or isolated database:

```bash
gunzip -c backups/postgres-<timestamp>-sha-<commit>.sql.gz \
  | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
      sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

MinIO object data lives in the `minio_data` Docker volume, Postgres data in `postgres_data`, and Redis data in `redis_data`. Back those volumes up separately at the host level if point-in-time disaster recovery matters.

## Production Checks

After deploy:

```bash
curl -fsS https://$BETTERSPEND_DOMAIN/api/v1/health
curl -fsS https://$BETTERSPEND_DOMAIN/
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Postgres, Redis, and MinIO should not have public host port mappings. Only Caddy should expose `80` and `443`.
