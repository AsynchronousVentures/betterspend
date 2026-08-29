import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Inject } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { appendAuditLog } from '@betterspend/db';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const method = request.method;

    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(async (result) => {
        if (!result || !user) return;

        const actionMap: Record<string, string> = {
          POST: 'created',
          PUT: 'updated',
          PATCH: 'updated',
          DELETE: 'deleted',
        };
        const action = actionMap[method] || 'modified';

        try {
          await this.db.transaction((transaction) =>
            appendAuditLog(transaction, {
              organizationId: user.organizationId,
              userId: user.id,
              entityType: result._entityType || 'unknown',
              entityId: result.id || result._id || '00000000-0000-0000-0000-000000000000',
              action,
              changes: result._changes || {},
              metadata: {
                ip: request.ip,
                userAgent: request.headers['user-agent'],
                path: request.path,
              },
            }),
          );
        } catch {
          // Audit failures should not break the main operation
        }
      }),
    );
  }
}
