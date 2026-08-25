#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${BETTERSPEND_DEPLOY_DIR:-/opt/betterspend}"
ENV_FILE="${ENV_FILE:-.env.production}"
PRODUCTION_ENV_FILE="${PRODUCTION_ENV_FILE:-$ENV_FILE}"
COMPOSE_BASE_FILE="${COMPOSE_BASE_FILE:-compose.yaml}"
COMPOSE_PROD_FILE="${COMPOSE_PROD_FILE:-compose.prod.yaml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-betterspend}"

cd "$DEPLOY_DIR"

source "$DEPLOY_DIR/deploy/release-version.sh"

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

APP_VERSION="$(release_version_from_image_tag "$IMAGE_TAG")"

export APP_VERSION COMPOSE_PROJECT_NAME IMAGE_TAG PRODUCTION_ENV_FILE

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_BASE_FILE" -f "$COMPOSE_PROD_FILE" "$@"
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

echo "Rollback complete at image tag $IMAGE_TAG (version $APP_VERSION). Database migrations are forward-only and were not reverted."
