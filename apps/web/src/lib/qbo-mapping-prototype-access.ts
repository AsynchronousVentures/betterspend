import type { EffectiveAccessDocument } from '@betterspend/shared';

const QBO_MAPPING_PROTOTYPE_PATH = '/gl-mappings';

/** Keeps the throwaway mapping prototype directly viewable without weakening production auth. */
export function isQboMappingPrototypePath(pathname: string) {
  return process.env.NODE_ENV !== 'production' && pathname === QBO_MAPPING_PROTOTYPE_PATH;
}

export const QBO_MAPPING_PROTOTYPE_ACCESS = {
  user: {
    id: 'qbo-mapping-prototype-user',
    organizationId: 'qbo-mapping-prototype-org',
    email: 'prototype@betterspend.test',
    name: 'Prototype Admin',
    departmentId: null,
    isActive: true,
  },
  permissions: ['reports:view'],
  scopes: {},
} satisfies EffectiveAccessDocument;
