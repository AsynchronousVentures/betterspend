import { z } from 'zod';

export const requisitionLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive(),
  unitOfMeasure: z.string().min(1).max(50),
  unitPrice: z.number().nonnegative(),
  vendorId: z.string().uuid().optional(),
  catalogItemId: z.string().uuid().optional(),
  glAccount: z.string().max(50).optional(),
});

export const createRequisitionSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  neededBy: z.string().datetime().optional(),
  currency: z.string().length(3).default('USD'),
  lines: z.array(requisitionLineSchema).min(1),
});

export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>;

export const createRequisitionTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  isOrgWide: z.boolean().default(false),
  templateData: z.object({
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    departmentId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    currency: z.string().length(3).default('USD'),
    lines: z.array(requisitionLineSchema).min(1),
  }),
});

export const createTemplateFromRequisitionSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  isOrgWide: z.boolean().default(false),
});

export type CreateRequisitionTemplateInput = z.infer<typeof createRequisitionTemplateSchema>;
export type CreateTemplateFromRequisitionInput = z.infer<typeof createTemplateFromRequisitionSchema>;
