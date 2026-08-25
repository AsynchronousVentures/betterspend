import { z } from 'zod';

export const bootstrapInstanceSchema = z.object({
  organizationName: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(128),
});

export type BootstrapInstanceInput = z.infer<typeof bootstrapInstanceSchema>;
