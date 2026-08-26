import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { resolveRouteAccess } from '../../common/decorators/route-access.decorator';
import { AUTH_INSTANCE } from './auth.tokens';
import type { AuthInstance, AuthSession, AuthUser } from '../../auth/auth.instance';
import { DB_TOKEN } from '../../database/database.module';
import { and, eq, gt } from 'drizzle-orm';
import * as schema from '@betterspend/db';
import { isDemoModeEnabled } from '../../common/demo-mode';
import { AccessPolicyService, type AccessPolicy } from './access-policy';

// Extend Express Request to carry our user type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authSessionId?: string;
      authUser?: AuthUser;
      authAccess?: AccessPolicy;
    }
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: AuthInstance,
    @Inject(DB_TOKEN)
    private readonly db: ReturnType<typeof import('drizzle-orm/postgres-js').drizzle>,
    private readonly accessPolicy: AccessPolicyService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const routeAccess = resolveRouteAccess(ctx.getHandler(), ctx.getClass());
    if (routeAccess.status === 'resolved' && routeAccess.access.kind === 'public') return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);

    const db = this.db as any;
    let session: AuthSession | undefined;
    let user: AuthUser | undefined;
    if (token) {
      [session] = await db
        .select()
        .from(schema.authSessions)
        .where(
          and(eq(schema.authSessions.token, token), gt(schema.authSessions.expiresAt, new Date())),
        )
        .limit(1);
      if (!session) throw new UnauthorizedException('Invalid or expired session token');
    } else {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, value);
      }
      const cookieSession = await this.auth.api.getSession({ headers });
      if (!cookieSession) {
        if (isDemoModeEnabled()) return true;
        throw new UnauthorizedException('Authentication required');
      }
      session = cookieSession.session;
      user = cookieSession.user;
    }

    // Always load the current row, including for cookie sessions. Better Auth
    // may have returned a cached user document, while deactivation must take
    // effect at this seam immediately.
    [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.userId))
      .limit(1);

    if (!user) throw new UnauthorizedException('User not found');
    if (!user.isActive) throw new UnauthorizedException('User is inactive');

    const resolved = await this.accessPolicy.resolve(user);
    req.authUser = user;
    req.authAccess = resolved.policy;
    req.authSessionId = session.id;
    return true;
  }

  private extractToken(req: Request): string | null {
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
    return null;
  }
}
