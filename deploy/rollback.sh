#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${BETTERSPEND_DEPLOY_DIR:-/opt/betterspend}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-betterspend}"

cd "$DEPLOY_DIR"

IMAGE_TAG="${1:-}"
if [ -z "$IMAGE_TAG" ]; then
  if [ ! -f .previous_image_tag ]; then
    echo "Pass an image tag or create .previous_image_tag by completing at least two deployments." >&2
    exit 1
  fi
  IMAGE_TAG="$(cat .previous_image_tag)"
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $DEPLOY_DIR/$ENV_FILE." >&2
  exit 1
fi

export COMPOSE_PROJECT_NAME IMAGE_TAG

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "Rolling BetterSpend back to image tag $IMAGE_TAG..."
compose pull api web
compose up -d --remove-orphans

domain="$(awk -F= '$1 == "BETTERSPEND_DOMAIN" { print $2 }' "$ENV_FILE" | tail -n 1 | tr -d '"')"
if [ -n "$domain" ]; then
  curl --retry 12 --retry-delay 5 --retry-all-errors -fsS "https://$domain/api/v1/health" >/dev/null
  curl --retry 12 --retry-delay 5 --retry-all-errors -fsS "https://$domain/" >/dev/null
fi

printf '%s\n' "$IMAGE_TAG" > .current_image_tag

echo "Rollback complete. Database migrations are forward-only and were not reverted."
