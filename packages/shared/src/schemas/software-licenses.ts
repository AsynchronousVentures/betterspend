import { z } from 'zod';

export const SOFTWARE_LICENSE_STATUSES = ['active', 'renewal_due', 'cancelled', 'expired'] as const;
export const SOFTWARE_BILLING_CYCLES = ['monthly', 'annual'] as const;

export const softwareLicenseSchema = z.object({
  vendorId: z.string().uuid(),
  contractId: z.string().uuid().optional(),
  productName: z.string().min(1).max(255),
  status: z.enum(SOFTWARE_LICENSE_STATUSES).default('active'),
  seatCount: z.number().int().min(1).default(1),
  seatsUsed: z.number().int().min(0).default(0),
  pricePerSeat: z.string().default('0'),
  currency: z.string().length(3).default('USD'),
  billingCycle: z.enum(SOFTWARE_BILLING_CYCLES).default('annual'),
  renewalDate: z.string().datetime({ offset: true }).optional(),
  autoRenews: z.boolean().default(true),
  renewalLeadDays: z.number().int().min(1).max(365).default(30),
  ownerUserId: z.string().uuid().optional(),
  notes: z.string().max(5000).optional(),
});

export type SoftwareLicenseInput = z.infer<typeof softwareLicenseSchema>;
