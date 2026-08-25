const SHA_TAG_PATTERN = /^sha-[0-9a-f]{7,64}$/i;

function isAsciiDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

function isValidNumericIdentifier(value: string): boolean {
  if (!value || (value.length > 1 && value.startsWith('0'))) return false;
  return [...value].every(isAsciiDigit);
}

function isValidPrereleaseIdentifier(value: string): boolean {
  if (!value) return false;
  let hasNonDigit = false;

  for (const character of value) {
    const isLetter =
      (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');
    if (!isAsciiDigit(character) && !isLetter && character !== '-') return false;
    if (!isAsciiDigit(character)) hasNonDigit = true;
  }

  return hasNonDigit || isValidNumericIdentifier(value);
}

function isValidSemanticVersion(value: string): boolean {
  if (!value || value.length > 127 || value.includes('+')) return false;

  const prereleaseSeparator = value.indexOf('-');
  const core = prereleaseSeparator === -1 ? value : value.slice(0, prereleaseSeparator);
  const prerelease = prereleaseSeparator === -1 ? null : value.slice(prereleaseSeparator + 1);
  const coreIdentifiers = core.split('.');

  if (coreIdentifiers.length !== 3 || !coreIdentifiers.every(isValidNumericIdentifier)) return false;
  return prerelease === null || prerelease.split('.').every(isValidPrereleaseIdentifier);
}

/** Returns a display-safe release value, or null for an invalid runtime value. */
export function normalizeReleaseVersion(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const semver = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
  if (isValidSemanticVersion(semver)) return semver;
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
