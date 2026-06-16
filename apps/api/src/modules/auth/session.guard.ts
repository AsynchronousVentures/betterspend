import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AUTH_INSTANCE } from './auth.tokens';
import type { AuthInstance, AuthUser } from '../../auth/auth.instance';
import { DB_TOKEN } from '../../database/database.module';
import { and, eq, gt, inArray } from 'drizzle-orm';
import * as schema from '@betterspend/db';

// Extend Express Request to carry our user type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser & {
        roles: Array<{
          role: string;
          scopeType: string;
          scopeId: string | null;
          customRoleId?: string | null;
          customRole?: { id: string; name: string; permissions: string[] } | null;
        }>;
      };
    }
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_INSTANCE) private readonly auth: AuthInstance,
    @Inject(DB_TOKEN) private readonly db: ReturnType<typeof import('drizzle-orm/postgres-js').drizzle>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);

    // No token — allow through in demo/dev mode (@CurrentOrgId falls back to demo IDs)
    if (!token) return true;

    // Validate the Bearer token directly against the DB.
    // better-auth's getSession only reads its own cookie format, not Bearer tokens,
    // so we query authSessions directly to avoid that limitation.
    const db = this.db as any;

    const [session] = await db
      .select()
      .from(schema.authSessions)
      .where(
        and(
          eq(schema.authSessions.token, token),
          gt(schema.authSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      throw new UnauthorizedException('Invalid or expired session token');
    }

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.userId))
      .limit(1);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const roles = await db
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, user.id));

    const customRoleIds = roles
      .map((role: any) => role.customRoleId)
      .filter((id: unknown): id is string => typeof id === 'string');

    const customRoleRows = customRoleIds.length
      ? await db
          .select()
          .from(schema.customRoles)
          .where(inArray(schema.customRoles.id, customRoleIds))
      : [];

    const customRolesById = new Map(customRoleRows.map((role: any) => [role.id, role]));
    req.authUser = {
      ...user,
      roles: roles.map((role: any) => ({
        ...role,
        customRole: role.customRoleId ? customRolesById.get(role.customRoleId) ?? null : null,
      })),
    };
    return true;
  }

  private extractToken(req: Request): string | null {
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
    return null;
  }
}
