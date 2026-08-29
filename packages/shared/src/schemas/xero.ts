import { z } from 'zod';

const xeroGrantIdSchema = z.string().trim().min(1).max(128);
const xeroTenantIdSchema = z.string().trim().min(1).max(255);

export const xeroGrantQuerySchema = z.object({
  grantId: xeroGrantIdSchema,
});

export const xeroTenantSelectionSchema = z.object({
  grantId: xeroGrantIdSchema,
  tenantId: xeroTenantIdSchema,
});

export type XeroGrantQuery = z.infer<typeof xeroGrantQuerySchema>;
export type XeroTenantSelectionInput = z.infer<typeof xeroTenantSelectionSchema>;
