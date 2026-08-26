import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { EffectiveAccessDocument } from '@betterspend/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/auth.instance';
import type { AccessPolicy } from './access-policy';
import { CurrentAccess } from './current-access.decorator';

@ApiTags('auth')
@Controller('me')
export class AccessController {
  @Get('access')
  @ApiOperation({ summary: 'Get effective permissions and scopes for the current user' })
  getAccess(
    @CurrentUser() user: AuthUser | undefined,
    @CurrentAccess() policy: AccessPolicy | undefined,
  ): EffectiveAccessDocument {
    if (!user || !policy) throw new UnauthorizedException('Authentication required');
    return {
      user: {
        id: user.id,
        organizationId: user.organizationId,
        email: user.email,
        name: user.name,
        departmentId: user.departmentId ?? null,
        isActive: user.isActive,
      },
      ...policy.toDocument(),
    };
  }
}
