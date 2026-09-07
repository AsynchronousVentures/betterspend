const DEVELOPMENT_SECRET = 'betterspend-dev-secret-change-in-prod';
const EXAMPLE_SECRET = 'change-me-use-openssl-rand-hex-32';

export function resolveAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.BETTER_AUTH_SECRET;
  if (env.NODE_ENV === 'production') {
    if (
      !secret ||
      secret.trim().length < 32 ||
      [
        DEVELOPMENT_SECRET,
        EXAMPLE_SECRET,
        'change-me-in-production-use-openssl-rand-hex-32',
      ].includes(secret.trim())
    ) {
      throw new Error(
        'Production requires a non-default BETTER_AUTH_SECRET of at least 32 characters',
      );
    }
    return secret;
  }
  return secret || DEVELOPMENT_SECRET;
}
