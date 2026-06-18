#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${BETTERSPEND_DEPLOY_DIR:-/opt/betterspend}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-betterspend}"
IMAGE_TAG="${1:-${IMAGE_TAG:-}}"

if [ -z "$IMAGE_TAG" ]; then
  echo "IMAGE_TAG is required. Pass it as the first argument or export IMAGE_TAG." >&2
  exit 1
fi

cd "$DEPLOY_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $DEPLOY_DIR/$ENV_FILE. Create it from .env.production.example before deploying." >&2
  exit 1
fi

export COMPOSE_PROJECT_NAME IMAGE_TAG

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

compose_with_migrate_profile() {
  docker compose --profile migrate --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "Pulling BetterSpend images for $IMAGE_TAG..."
compose pull api web
compose_with_migrate_profile pull migrator

echo "Starting stateful services..."
compose up -d postgres redis minio

echo "Waiting for PostgreSQL..."
for attempt in $(seq 1 60); do
  if compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
    break
  fi

  if [ "$attempt" -eq 60 ]; then
    echo "PostgreSQL did not become ready in time." >&2
    exit 1
  fi

  sleep 2
done

mkdir -p backups
backup_file="backups/postgres-$(date -u +%Y%m%dT%H%M%SZ)-${IMAGE_TAG}.sql.gz"
echo "Writing PostgreSQL backup to $backup_file..."
compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip -9 > "$backup_file"

echo "Running database migrations..."
compose_with_migrate_profile run --rm migrator

echo "Starting application stack..."
compose up -d --remove-orphans

domain="$(awk -F= '$1 == "BETTERSPEND_DOMAIN" { print $2 }' "$ENV_FILE" | tail -n 1 | tr -d '"')"
if [ -z "$domain" ]; then
  echo "BETTERSPEND_DOMAIN is required in $ENV_FILE for smoke checks." >&2
  exit 1
fi

echo "Running smoke checks for https://$domain..."
curl --retry 12 --retry-delay 5 --retry-all-errors -fsS "https://$domain/api/v1/health" >/dev/null
curl --retry 12 --retry-delay 5 --retry-all-errors -fsS "https://$domain/" >/dev/null

if [ -f .current_image_tag ]; then
  cp .current_image_tag .previous_image_tag
fi
printf '%s\n' "$IMAGE_TAG" > .current_image_tag

echo "BetterSpend deployed successfully at image tag $IMAGE_TAG."
