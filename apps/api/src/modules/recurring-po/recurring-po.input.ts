import { BadRequestException } from '@nestjs/common';
import {
  createRecurringPoSchema,
  recurringPoLinesSchema,
  updateRecurringPoSchema,
  type CreateRecurringPoInput,
  type UpdateRecurringPoInput,
} from '@betterspend/shared';
import { z } from 'zod';

export {
  calculateRecurringPoAmounts,
  type CreateRecurringPoInput,
  type RecurringPoFrequency,
  type RecurringPoLine,
  type UpdateRecurringPoInput,
} from '@betterspend/shared';

function parseInput<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues[0]?.message ?? 'Invalid recurring PO request',
    );
  }
  return parsed.data;
}

export function parseRecurringPoCreateInput(body: unknown): CreateRecurringPoInput {
  return parseInput(createRecurringPoSchema, body);
}

export function parseRecurringPoUpdateInput(body: unknown): UpdateRecurringPoInput {
  return parseInput(updateRecurringPoSchema, body);
}

export function parseStoredRecurringPoLines(body: unknown) {
  return parseInput(recurringPoLinesSchema, body);
}
