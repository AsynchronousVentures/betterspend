import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const cursorSchema = z
  .object({
    createdAt: z.string().datetime({ precision: 6 }),
    id: z.guid(),
  })
  .strict();

type InvoiceListCursor = z.infer<typeof cursorSchema>;

export function encodeInvoiceListCursor(cursor: InvoiceListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeInvoiceListCursor(value: string): InvoiceListCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new BadRequestException('Invalid invoice cursor');
  }
}
