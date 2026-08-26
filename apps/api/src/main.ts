import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { createAuthInstance } from './auth/auth.instance';
import { assertDemoModeIsSafe } from './common/demo-mode';

async function bootstrap() {
  assertDemoModeIsSafe();
  const app = await NestFactory.create(AppModule);

  // Security headers (CSP disabled — Swagger UI needs inline scripts)
  app.use(helmet({ contentSecurityPolicy: false }));

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: process.env.WEB_URL || 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Mount better-auth handler at /api/auth/* (before NestJS global prefix)
  const auth = await createAuthInstance();
  const { toNodeHandler } = await import('better-auth/node');
  app.use('/api/auth', toNodeHandler(auth.handler));

  const config = new DocumentBuilder()
    .setTitle('BetterSpend API')
    .setDescription('Purchase Order Management System API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.API_PORT || 3001;
  await app.listen(port);
  console.log(`BetterSpend API running on http://localhost:${port}`);
  console.log(`API Docs: http://localhost:${port}/api/docs`);
}

bootstrap();
