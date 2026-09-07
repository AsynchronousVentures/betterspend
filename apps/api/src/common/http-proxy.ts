import type { INestApplication } from '@nestjs/common';

export function configureHttpProxy(app: INestApplication, env: NodeJS.ProcessEnv = process.env) {
  // Supported production Compose exposes only Caddy. It overwrites incoming
  // forwarded headers and appends the client address as the nearest hop.
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);
}
