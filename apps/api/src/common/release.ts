import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveReleaseVersion } from '@betterspend/shared';

function readPackageVersion(): string {
  try {
    const packageJsonPath = join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as unknown;
    if (typeof packageJson === 'object' && packageJson !== null && 'version' in packageJson) {
      const version = packageJson.version;
      if (typeof version === 'string') return version;
    }
  } catch {
    // The package fallback is optional in unusual test/runtime layouts.
  }

  return '0.0.0';
}

export function getAppVersion(
  runtimeValue = process.env.APP_VERSION,
  packageVersion = readPackageVersion(),
): string {
  return resolveReleaseVersion(runtimeValue, packageVersion);
}
