import { z } from 'zod';

export const SETTING_KEYS = [
  'app_name',
  'app_logo_url',
  'app_favicon_url',
  'copyright_text',
  'support_email',
  'primary_color',
  'accent_color',
  'hide_powered_by',
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_pass',
  'smtp_from',
  'smtp_secure',
  'auto_approve_threshold',
  'auto_approve_require_budget_check',
  'auto_approve_notify_manager',
  'prevent_invoice_self_approval',
  'budget_enforcement_mode',
  'budget_pending_requisition_policy',
  'catalog_auto_approve_price_change_pct',
  'contract_price_deviation_threshold',
  'contract_price_deviation_action',
  'block_pos_for_flagged_vendors',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  app_name: 'BetterSpend',
  app_logo_url: '',
  app_favicon_url: '',
  copyright_text: '© 2026 BetterSpend. Open source under MIT License.',
  support_email: '',
  primary_color: '#3b82f6',
  accent_color: '#0f172a',
  hide_powered_by: 'false',
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: 'noreply@betterspend.io',
  smtp_secure: 'false',
  auto_approve_threshold: '0',
  auto_approve_require_budget_check: 'false',
  auto_approve_notify_manager: 'true',
  prevent_invoice_self_approval: 'true',
  budget_enforcement_mode: 'hard_stop',
  budget_pending_requisition_policy: 'approved_only',
  catalog_auto_approve_price_change_pct: '0',
  contract_price_deviation_threshold: '5',
  contract_price_deviation_action: 'warn',
  block_pos_for_flagged_vendors: 'false',
};

export const brandingSettingsSchema = z.object({
  app_name: z.string().min(1).max(100).optional(),
  app_logo_url: z.string().url().or(z.literal('')).optional(),
  app_favicon_url: z.string().url().or(z.literal('')).optional(),
  copyright_text: z.string().max(255).optional(),
  support_email: z.string().email().or(z.literal('')).optional(),
  primary_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  accent_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  hide_powered_by: z.enum(['true', 'false']).optional(),
});

export const smtpSettingsSchema = z.object({
  smtp_host: z.string().optional(),
  smtp_port: z.string().optional(),
  smtp_user: z.string().optional(),
  smtp_pass: z.string().optional(),
  smtp_from: z.string().email().or(z.literal('')).optional(),
  smtp_secure: z.enum(['true', 'false']).optional(),
});

export const approvalPolicySettingsSchema = z.object({
  auto_approve_threshold: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid dollar amount')
    .optional(),
  auto_approve_require_budget_check: z.enum(['true', 'false']).optional(),
  auto_approve_notify_manager: z.enum(['true', 'false']).optional(),
  prevent_invoice_self_approval: z.enum(['true', 'false']).optional(),
  budget_enforcement_mode: z.enum(['hard_stop', 'owner_approval', 'visibility_only']).optional(),
  budget_pending_requisition_policy: z.enum(['approved_only', 'include_pending']).optional(),
  // Percentage (0-100). Supplier catalog price changes within this percent are
  // approved without review. '0' disables the automation.
  catalog_auto_approve_price_change_pct: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid percentage')
    .refine((value) => Number(value) <= 100, 'Must be between 0 and 100')
    .optional(),
});

export const contractComplianceSettingsSchema = z.object({
  contract_price_deviation_threshold: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  contract_price_deviation_action: z.enum(['warn', 'block']).optional(),
});

export const riskScreeningSettingsSchema = z.object({
  // When true, PO creation is rejected for vendors with sanctions_status
  // 'flagged'. Default warn-only.
  block_pos_for_flagged_vendors: z.enum(['true', 'false']).optional(),
});
