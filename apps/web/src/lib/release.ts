import packageJson from '../../../../package.json';
import { normalizeReleaseVersion } from '@betterspend/shared';

export const appReleaseVersion = packageJson.version;
export const appReleaseLabel = `BetterSpend v${appReleaseVersion}`;

export function parseRuntimeReleaseVersion(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('version' in value)) return null;
  const version = value.version;
  return typeof version === 'string' ? normalizeReleaseVersion(version) : null;
}
