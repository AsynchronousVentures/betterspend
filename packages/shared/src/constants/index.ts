export const ROLES = {
  ADMIN: 'admin',
  APPROVER: 'approver',
  REQUESTER: 'requester',
  RECEIVER: 'receiver',
  FINANCE: 'finance',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const PO_STATUS = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  ISSUED: 'issued',
  PARTIALLY_RECEIVED: 'partially_received',
  RECEIVED: 'received',
  PARTIALLY_INVOICED: 'partially_invoiced',
  INVOICED: 'invoiced',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
} as const;

export const REQUISITION_STATUS = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  CONVERTED: 'converted',
} as const;

export const VENDOR_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  BLOCKED: 'blocked',
} as const;

export const NUMBER_PREFIXES = {
  REQUISITION: 'REQ',
  PURCHASE_ORDER: 'PO',
  GOODS_RECEIPT: 'GRN',
  INVOICE: 'INV',
} as const;

export const INTEGRATION_CONNECTION_STATUS = {
  ACTIVE: 'active',
  RECONNECT_REQUIRED: 'reconnect_required',
  REVOKED: 'revoked',
} as const;

export type IntegrationConnectionStatus =
  (typeof INTEGRATION_CONNECTION_STATUS)[keyof typeof INTEGRATION_CONNECTION_STATUS];

export const SYNC_RECORD_STATUS = {
  PENDING: 'pending',
  QUEUED: 'queued',
  SKIPPED: 'skipped',
  SYNCED: 'synced',
  FAILED: 'failed',
} as const;

export type SyncRecordStatus = (typeof SYNC_RECORD_STATUS)[keyof typeof SYNC_RECORD_STATUS];
