import { z } from 'zod';

export const PUNCHOUT_DIALECTS = ['cxml', 'oci'] as const;
export const PUNCHOUT_ENVIRONMENTS = ['test', 'production'] as const;
export const PUNCHOUT_CONNECTION_STATUSES = ['unverified', 'verified', 'auth_failed'] as const;
export const PUNCHOUT_AUTH_FAILURE_THRESHOLD = 3;

export const punchoutDialectSchema = z.enum(PUNCHOUT_DIALECTS);
export const punchoutEnvironmentSchema = z.enum(PUNCHOUT_ENVIRONMENTS);
export const punchoutConnectionStatusSchema = z.enum(PUNCHOUT_CONNECTION_STATUSES);

const endpointSchema = z
  .string()
  .trim()
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  }, 'PunchOut endpoints must use HTTP(S) without credentials or fragments');
const identitySchema = z.string().trim().min(1).max(255);

/** Editable supplier values. The shared secret is write-only at the API boundary. */
export const punchoutEnvironmentInputSchema = z
  .object({
    setupUrl: endpointSchema,
    orderUrl: endpointSchema,
    fromDomain: identitySchema,
    fromIdentity: identitySchema,
    toDomain: identitySchema,
    toIdentity: identitySchema,
    senderIdentity: identitySchema,
    sharedSecret: z.string().trim().min(1).max(4_096),
  })
  .strict()
  .partial();

/** Partial update accepted by the vendor PunchOut settings endpoint. */
export const punchoutConfigInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    dialect: punchoutDialectSchema.optional(),
    activeEnvironment: punchoutEnvironmentSchema.optional(),
    environments: z
      .object({
        test: punchoutEnvironmentInputSchema.optional(),
        production: punchoutEnvironmentInputSchema.optional(),
      })
      .strict()
      .partial()
      .optional(),
  })
  .strict();

const storedStringSchema = z.string().trim().min(1).max(2_048).optional();

/** JSON shape persisted in vendors.punchout_config. Secrets never use plaintext fields here. */
export const punchoutStoredEnvironmentSchema = z
  .object({
    setupUrl: storedStringSchema,
    orderUrl: storedStringSchema,
    fromDomain: storedStringSchema,
    fromIdentity: storedStringSchema,
    toDomain: storedStringSchema,
    toIdentity: storedStringSchema,
    senderIdentity: storedStringSchema,
    encryptedSharedSecret: z.string().min(1).max(16_384).optional(),
    sharedSecretHint: z.string().min(1).max(80).optional(),
    status: punchoutConnectionStatusSchema.default('unverified'),
    consecutiveAuthFailures: z.number().int().nonnegative().default(0),
    lastCheckedAt: z.string().datetime({ offset: true }).nullable().default(null),
    lastError: z.string().max(500).nullable().default(null),
  })
  .strict();

export const punchoutStoredConfigSchema = z
  .object({
    dialect: punchoutDialectSchema.default('cxml'),
    activeEnvironment: punchoutEnvironmentSchema.default('test'),
    environments: z
      .object({
        test: punchoutStoredEnvironmentSchema.default({
          status: 'unverified',
          consecutiveAuthFailures: 0,
          lastCheckedAt: null,
          lastError: null,
        }),
        production: punchoutStoredEnvironmentSchema.default({
          status: 'unverified',
          consecutiveAuthFailures: 0,
          lastCheckedAt: null,
          lastError: null,
        }),
      })
      .strict(),
  })
  .strict();

const maskedEnvironmentSchema = z
  .object({
    setupUrl: z.string().nullable(),
    orderUrl: z.string().nullable(),
    fromDomain: z.string().nullable(),
    fromIdentity: z.string().nullable(),
    toDomain: z.string().nullable(),
    toIdentity: z.string().nullable(),
    senderIdentity: z.string().nullable(),
    sharedSecretConfigured: z.boolean(),
    sharedSecretMasked: z.string().nullable(),
    status: punchoutConnectionStatusSchema,
    consecutiveAuthFailures: z.number().int().nonnegative(),
    lastCheckedAt: z.string().datetime({ offset: true }).nullable(),
    lastError: z.string().nullable(),
  })
  .strict();

/** Safe response contract. It intentionally has no encrypted or plaintext secret field. */
export const punchoutConfigResponseSchema = z
  .object({
    vendorId: z.string().uuid(),
    enabled: z.boolean(),
    dialect: punchoutDialectSchema,
    activeEnvironment: punchoutEnvironmentSchema,
    environments: z.object({
      test: maskedEnvironmentSchema,
      production: maskedEnvironmentSchema,
    }),
  })
  .strict();

export type PunchoutEnvironment = z.infer<typeof punchoutEnvironmentSchema>;
export type PunchoutDialect = z.infer<typeof punchoutDialectSchema>;
export type PunchoutConnectionStatus = z.infer<typeof punchoutConnectionStatusSchema>;
export type PunchoutEnvironmentInput = z.infer<typeof punchoutEnvironmentInputSchema>;
export type PunchoutConfigInput = z.infer<typeof punchoutConfigInputSchema>;
export type PunchoutStoredEnvironment = z.infer<typeof punchoutStoredEnvironmentSchema>;
export type PunchoutStoredConfig = z.infer<typeof punchoutStoredConfigSchema>;
export type PunchoutConfigResponse = z.infer<typeof punchoutConfigResponseSchema>;
