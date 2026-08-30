import { z } from 'zod';

export const QBO_CATALOG_ENTITY_TYPES = [
  'Account',
  'Vendor',
  'Class',
  'Department',
  'Customer',
  'Term',
] as const;

export const QBO_TAX_ENTITY_TYPES = ['TaxCode', 'TaxRate'] as const;

export const QBO_SYNC_ENTITY_TYPES = [
  ...QBO_CATALOG_ENTITY_TYPES,
  ...QBO_TAX_ENTITY_TYPES,
] as const;

export const qboSyncEntitySchema = z.enum(QBO_SYNC_ENTITY_TYPES);

export const qboSyncRequestSchema = z
  .object({
    entityTypes: z.array(qboSyncEntitySchema).min(1).optional(),
  })
  .strict();

export const qboMappingLinkInputSchema = z
  .object({
    localId: z.string().uuid().nullable(),
    autoCreated: z.boolean().optional(),
  })
  .strict();

export const qboQueuedSyncResponseSchema = z.object({
  queued: z.literal(true),
  jobId: z.string().optional(),
});

export const qboExternalEntityMappingSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  connectionId: z.string().uuid().nullable(),
  realmId: z.string().min(1).max(255),
  provider: z.literal('qbo'),
  externalEntity: qboSyncEntitySchema,
  externalId: z.string(),
  displayName: z.string().nullable(),
  syncToken: z.string().nullable(),
  localEntity: z.string(),
  localId: z.string().uuid().nullable(),
  direction: z.literal('inbound'),
  autoCreated: z.boolean(),
  isActive: z.boolean(),
  isDeleted: z.boolean(),
  mergedIntoExternalId: z.string().nullable(),
  payload: z.unknown().nullable(),
  syncedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const qboExternalEntityMappingListSchema = z.array(qboExternalEntityMappingSchema);

export type QboSyncEntity = z.infer<typeof qboSyncEntitySchema>;
export type QboSyncRequest = z.infer<typeof qboSyncRequestSchema>;
export type QboMappingLinkInput = z.infer<typeof qboMappingLinkInputSchema>;
export type QboQueuedSyncResponse = z.infer<typeof qboQueuedSyncResponseSchema>;
export type QboExternalEntityMapping = z.infer<typeof qboExternalEntityMappingSchema>;
export type QboExternalEntityMappingList = z.infer<typeof qboExternalEntityMappingListSchema>;
