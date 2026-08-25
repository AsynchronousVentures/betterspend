const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA_TAG_PATTERN = /^sha-[0-9a-f]{7,64}$/i;

/** Returns a display-safe release value, or null for an invalid runtime value. */
export function normalizeReleaseVersion(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const semver = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
  if (SEMVER_PATTERN.test(semver)) return semver;
  if (SHA_TAG_PATTERN.test(trimmed)) return trimmed;
  return null;
}

/** Prefer explicit runtime metadata while keeping local package fallback behavior. */
export function resolveReleaseVersion(
  runtimeValue: string | undefined,
  packageVersion: string,
): string {
  if (runtimeValue) {
    const normalized = normalizeReleaseVersion(runtimeValue);
    if (normalized) return normalized;
  }

  return packageVersion.trim() || '0.0.0';
}
