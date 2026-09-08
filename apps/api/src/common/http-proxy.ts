import type { INestApplication } from '@nestjs/common';

export function configureHttpProxy(app: INestApplication, env: NodeJS.ProcessEnv = process.env) {
  const hops = env.API_TRUST_PROXY_HOPS ?? '0';
  if (hops !== '0' && hops !== '1') {
    throw new Error('API_TRUST_PROXY_HOPS must be 0 for direct access or 1 behind Caddy');
  }
  // Trust depends on ingress, not NODE_ENV: local production builds expose the API directly.
  app.getHttpAdapter().getInstance().set('trust proxy', hops === '1' ? 1 : false);
}
