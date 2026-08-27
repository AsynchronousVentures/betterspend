import { z } from 'zod';

export const MESSAGE_THREAD_TYPES = ['po', 'rfq', 'grn', 'invoice'] as const;

export const messageThreadTypeSchema = z.enum(MESSAGE_THREAD_TYPES);

const uuidSchema = z.string().uuid();

export const messageAttachmentSchema = z
  .object({
    documentId: uuidSchema.optional(),
    url: z.string().url().optional(),
    name: z.string().max(255).optional(),
  })
  .refine(({ documentId, url }) => documentId !== undefined || url !== undefined, {
    message: 'Either documentId or url is required',
  });

export const postMessageSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  attachments: z.array(messageAttachmentSchema).max(20).optional(),
  recipientVendorId: uuidSchema.optional(),
});

export const messageSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  threadType: messageThreadTypeSchema,
  threadId: uuidSchema,
  senderType: z.enum(['user', 'vendor']),
  senderId: uuidSchema.nullable(),
  vendorId: uuidSchema.nullable(),
  recipientVendorId: uuidSchema.nullable(),
  authorName: z.string(),
  body: z.string(),
  attachments: z.array(messageAttachmentSchema),
  createdAt: z.string().datetime(),
});

export type MessageThreadType = z.infer<typeof messageThreadTypeSchema>;
export type PostMessageInput = z.infer<typeof postMessageSchema>;
export type Message = z.infer<typeof messageSchema>;
