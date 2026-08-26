import { SetMetadata } from '@nestjs/common';
import type { BuiltInRole } from '@betterspend/shared';

export type UserRole = BuiltInRole;

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
