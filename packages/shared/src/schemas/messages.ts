import { z } from 'zod';

export const MESSAGE_THREAD_TYPES = ['po', 'rfq', 'grn', 'invoice'] as const;

export const messageThreadTypeSchema = z.enum(MESSAGE_THREAD_TYPES);

export const messageAttachmentSchema = z.object({
  documentId: z.string().uuid().optional(),
  url: z.string().url().optional(),
  name: z.string().max(255).optional(),
});

export const postMessageSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  attachments: z.array(messageAttachmentSchema).max(20).optional(),
  recipientVendorId: z.string().uuid().optional(),
});

export const messageSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  threadType: messageThreadTypeSchema,
  threadId: z.string().uuid(),
  senderType: z.enum(['user', 'vendor']),
  senderId: z.string().uuid().nullable(),
  vendorId: z.string().uuid().nullable(),
  recipientVendorId: z.string().uuid().nullable(),
  authorName: z.string(),
  body: z.string(),
  attachments: z.array(messageAttachmentSchema),
  createdAt: z.string().datetime(),
});

export type MessageThreadType = z.infer<typeof messageThreadTypeSchema>;
export type PostMessageInput = z.infer<typeof postMessageSchema>;
export type Message = z.infer<typeof messageSchema>;
