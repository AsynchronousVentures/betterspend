#!/usr/bin/env bash

# Derive the displayed runtime version from the immutable image tag selected
# for a deployment. Release tags lose their leading v, while SHA tags remain
# visible for exact-image testing.
release_version_from_image_tag() {
  local image_tag="$1"
  local semver_pattern='^v((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?)$'

  if [[ "$image_tag" =~ $semver_pattern ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  if [[ "$image_tag" =~ ^sha-[0-9a-fA-F]{7,64}$ ]]; then
    printf '%s\n' "$image_tag"
    return 0
  fi

  printf 'Unsupported image tag for APP_VERSION derivation: %s\n' "$image_tag" >&2
  return 1
}
