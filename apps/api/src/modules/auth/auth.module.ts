import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createAuthInstance } from '../../auth/auth.instance';
import { SessionGuard } from './session.guard';
import { RolesGuard } from './roles.guard';
import { AUTH_INSTANCE } from './auth.tokens';
import { AccessPolicyService } from './access-policy';
import { AccessController } from './access.controller';

export { AUTH_INSTANCE } from './auth.tokens';

@Global()
@Module({
  providers: [
    {
      provide: AUTH_INSTANCE,
      useFactory: () => createAuthInstance(),
    },
    SessionGuard,
    RolesGuard,
    AccessPolicyService,
    // SessionGuard runs first: validates the Bearer token and populates req.authUser.
    // RolesGuard runs second: enforces @Roles() metadata on the resolved user.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  controllers: [AccessController],
  exports: [AUTH_INSTANCE, SessionGuard, RolesGuard, AccessPolicyService],
})
export class AuthModule {}
