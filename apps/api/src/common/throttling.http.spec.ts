import { Controller, Get, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../app.module';
import { HealthController } from '../modules/health/health.controller';
import { configureHttpProxy } from './http-proxy';

@Controller('fixture')
class FixtureController {
  @Get()
  get() {
    return { ok: true };
  }
}

describe('API throttling', () => {
  let app: INestApplication;
  let url: string;
  beforeAll(async () => {
    const providers: unknown[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule);
    expect(providers).toContainEqual({ provide: APP_GUARD, useClass: ThrottlerGuard });
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 2000, limit: 2 }])],
      controllers: [FixtureController, HealthController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();
    app = module.createNestApplication();
    configureHttpProxy(app, { NODE_ENV: 'production' });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });
  afterAll(async () => {
    await app.close();
  });
  const get = (forwarded: string, path = '/fixture') =>
    fetch(url + path, { headers: { 'x-forwarded-for': forwarded } });

  it('limits the nearest client, ignores forged preceding hops and resets', async () => {
    expect((await get('192.0.2.1')).status).toBe(200);
    expect((await get('192.0.2.2, 192.0.2.1')).status).toBe(200);
    expect((await get('192.0.2.3, 192.0.2.1')).status).toBe(429);
    expect((await get('192.0.2.2')).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect((await get('192.0.2.1')).status).toBe(200);
  });

  it('keeps health probes available beyond the window budget', async () => {
    for (let i = 0; i < 4; i++) expect((await get('192.0.2.9', '/health')).status).toBe(200);
  });

  it('does not trust forwarding headers on direct development connections', async () => {
    configureHttpProxy(app, { NODE_ENV: 'development' });
    expect((await get('192.0.2.11')).status).toBe(200);
    expect((await get('192.0.2.12')).status).toBe(200);
    expect((await get('192.0.2.13')).status).toBe(429);
  });
});
