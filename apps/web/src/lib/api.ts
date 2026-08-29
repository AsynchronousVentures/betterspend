import {
  messageSchema,
  sanctionsIngestResultSchema,
  screenAllVendorsResultSchema,
  type MessageThreadType,
  type EffectiveAccessDocument,
  vendorScreeningResultSchema,
  vendorScreeningStatusSchema,
} from '@betterspend/shared';
import { apiUrl } from './api-url';
import type { ReceivingDetail, ReceivingListItem } from './receiving';

const ENTITY_STORAGE_KEY = 'betterspend:selected-entity-id';

export type ApiErrorKind = 'unauthorized' | 'forbidden' | 'network' | 'server' | 'request';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;

  constructor(message: string, options: { kind: ApiErrorKind; status?: number | null }) {
    super(message);
    this.name = 'ApiError';
    this.kind = options.kind;
    this.status = options.status ?? null;
  }
}

function errorKindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status >= 500) return 'server';
  return 'request';
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object' || !('message' in payload)) return fallback;
  const message = payload.message;
  if (typeof message === 'string' && message.trim()) return message;
  if (Array.isArray(message)) {
    const first = message.find(
      (value): value is string => typeof value === 'string' && Boolean(value.trim()),
    );
    if (first) return first;
  }
  return fallback;
}

async function responseError(res: Response): Promise<ApiError> {
  const payload: unknown = await res.json().catch(() => null);
  const kind = errorKindForStatus(res.status);
  return new ApiError(
    kind === 'server'
      ? 'Something went wrong. Try again.'
      : errorMessage(payload, `Request failed (${res.status})`),
    {
      kind,
      status: res.status,
    },
  );
}

function reportUnexpectedApiFailure(error: ApiError) {
  if (error.kind !== 'network' && error.kind !== 'server') return;
  console.error('[BetterSpend] API request failed', {
    kind: error.kind,
    status: error.status,
  });
}

function networkError(): ApiError {
  return new ApiError('Unable to reach BetterSpend. Check your connection and try again.', {
    kind: 'network',
  });
}

/** Maps client request failures to the user-facing states shared by data surfaces. */
export function loadFailureState(error: unknown): 'denied' | 'failed' {
  return error instanceof ApiError && (error.kind === 'unauthorized' || error.kind === 'forbidden')
    ? 'denied'
    : 'failed';
}

function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith(name + '='))
    ?.split('=')[1];
}

function clearAuthAndRedirect() {
  if (typeof document !== 'undefined') {
    document.cookie = 'bs_token=; Max-Age=0; path=/';
  }
  if (typeof window !== 'undefined') {
    window.location.replace('/login');
  }
}

function getSelectedEntityId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = window.localStorage.getItem(ENTITY_STORAGE_KEY);
  return value || undefined;
}

function appendEntityId(path: string, entityId?: string): string {
  const selectedEntityId = entityId ?? getSelectedEntityId();
  if (!selectedEntityId) return path;

  const [pathname, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('entityId', selectedEntityId);
  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

function withEntityBody(data: unknown): unknown {
  const entityId = getSelectedEntityId();
  if (!entityId || !data || typeof data !== 'object' || Array.isArray(data)) return data;
  return { ...(data as Record<string, unknown>), entityId };
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getCookie('bs_token');
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/v1${path}`), {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
      ...options,
    });
  } catch {
    const error = networkError();
    reportUnexpectedApiFailure(error);
    throw error;
  }

  if (res.status === 401) {
    clearAuthAndRedirect();
    throw new ApiError('Session expired. Please log in again.', {
      kind: 'unauthorized',
      status: 401,
    });
  }

  if (!res.ok) {
    const error = await responseError(res);
    reportUnexpectedApiFailure(error);
    throw error;
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

async function apiFetchForm<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getCookie('bs_token');
  const headers = new Headers(options?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/v1${path}`), {
      ...options,
      headers,
    });
  } catch {
    const error = networkError();
    reportUnexpectedApiFailure(error);
    throw error;
  }

  if (res.status === 401) {
    clearAuthAndRedirect();
    throw new ApiError('Session expired. Please log in again.', {
      kind: 'unauthorized',
      status: 401,
    });
  }

  if (!res.ok) {
    const error = await responseError(res);
    reportUnexpectedApiFailure(error);
    throw error;
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

async function vendorPortalFetch<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/v1${path}`), {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  } catch {
    const error = networkError();
    reportUnexpectedApiFailure(error);
    throw error;
  }

  if (!res.ok) {
    const error = await responseError(res);
    reportUnexpectedApiFailure(error);
    throw error;
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export type AiProviderId = 'anthropic' | 'openai' | 'openrouter';

export interface AiProviderStatus {
  provider: AiProviderId;
  label: string;
  connected: boolean;
  enabled: boolean;
  isDefault: boolean;
  supportsOAuth: boolean;
  authMethod: 'api_key' | 'oauth' | null;
  defaultModel: string;
  maskedCredential?: string;
  status: string;
  lastValidatedAt?: string;
  lastError?: string;
  metadata: Record<string, unknown>;
  dashboardUrl: string;
  modelPlaceholder: string;
  connectedAt?: string;
  updatedAt?: string;
}

export interface AiProvidersStatusResponse {
  defaultProvider: AiProviderId | null;
  providers: AiProviderStatus[];
}

export interface AiRequisitionParseLine {
  description: string;
  quantity: number;
  unitOfMeasure: string;
  unitPrice: number;
  glAccount?: string;
}

export interface AiRequisitionParseResponse {
  error?: string;
  title?: string;
  description?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  lines?: AiRequisitionParseLine[];
  suggestedVendor?: string;
  neededBy?: string;
  notes?: string;
}

export interface VendorEsgUpdateInput {
  diversityCategories?: string[];
  esgRating?: string;
  carbonFootprintTons?: string;
  sustainabilityCertifications?: string[];
  esgNotes?: string;
  diversityVerifiedAt?: string;
}

export interface VendorEsgUpdateResponse {
  id: string;
  diversityCategories: string[] | null;
  esgRating: string | null;
  carbonFootprintTons: string | null;
  sustainabilityCertifications: string[] | null;
  esgNotes: string | null;
  diversityVerifiedAt: string | null;
}

export interface VendorDiversitySummary {
  totalVendors: number;
  diverseVendors: number;
  diversityRate: number;
  esgRatedVendors: number;
  diversityBreakdown: Record<string, number>;
  esgRatingBreakdown: Record<string, number>;
  topDiverseVendors: Array<{
    id: string;
    name: string;
    categories: string[] | null;
    esgRating: string | null;
  }>;
}

export const api = {
  me: {
    access: () => apiFetch<EffectiveAccessDocument>('/me/access'),
  },
  account: {
    me: () =>
      apiFetch<{
        name: string;
        email: string;
        avatarUrl: string;
        hasCustomImage: boolean;
        pendingEmail: string | null;
        pendingEmailExpiresAt: string | null;
      }>('/account/me'),
    update: (data: { name: string }) =>
      apiFetch<{
        name: string;
        email: string;
        avatarUrl: string;
        hasCustomImage: boolean;
        pendingEmail: string | null;
        pendingEmailExpiresAt: string | null;
      }>('/account/me', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    changePassword: (data: { currentPassword: string; newPassword: string }) =>
      apiFetch<{ success?: boolean; message?: string }>('/account/me/change-password', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    requestEmailChange: (email: string) =>
      apiFetch<{ success: boolean; pendingEmail: string; pendingEmailExpiresAt: string }>(
        '/account/me/email/change-request',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
        },
      ),
    verifyEmail: (token: string) =>
      apiFetch<{ success: boolean; email: string; name: string }>('/account/me/email/verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    uploadAvatar: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return apiFetchForm<{
        name: string;
        email: string;
        avatarUrl: string;
        hasCustomImage: boolean;
        pendingEmail: string | null;
        pendingEmailExpiresAt: string | null;
      }>('/account/me/avatar', {
        method: 'POST',
        body,
      });
    },
    removeAvatar: () =>
      apiFetchForm<void>('/account/me/avatar', {
        method: 'DELETE',
      }),
  },
  health: {
    check: () =>
      apiFetch<{ status: string; timestamp: string; service: string; version: string }>('/health'),
  },
  entities: {
    list: (includeInactive = false) =>
      apiFetch<any[]>(`/entities${includeInactive ? '?includeInactive=true' : ''}`),
    get: (id: string) => apiFetch<any>(`/entities/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/entities', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/entities/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => apiFetch<any>(`/entities/${id}`, { method: 'DELETE' }),
  },
  exchangeRates: {
    list: () => apiFetch<any[]>('/exchange-rates'),
    create: (data: unknown) =>
      apiFetch<any>('/exchange-rates', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/exchange-rates/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => apiFetch<void>(`/exchange-rates/${id}`, { method: 'DELETE' }),
    getBaseCurrency: () =>
      apiFetch<{ baseCurrency: string }>('/exchange-rates/organization-base-currency'),
    updateBaseCurrency: (baseCurrency: string) =>
      apiFetch<any>('/exchange-rates/organization-base-currency', {
        method: 'PUT',
        body: JSON.stringify({ baseCurrency }),
      }),
  },
  spendGuard: {
    list: (status: 'open' | 'dismissed' | 'escalated' | 'all' = 'open') =>
      apiFetch<any[]>(`/spend-guard/alerts?status=${status}`),
    update: (id: string, data: { status: 'dismissed' | 'escalated'; note?: string }) =>
      apiFetch<any>(`/spend-guard/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
  vendors: {
    list: () => apiFetch<any[]>(appendEntityId('/vendors')),
    get: (id: string) => apiFetch<any>(`/vendors/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/vendors', { method: 'POST', body: JSON.stringify(withEntityBody(data)) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/vendors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(withEntityBody(data)),
      }),
    transactions: (id: string) => apiFetch<any>(`/vendors/${id}/transactions`),
    updateEsg: (id: string, data: VendorEsgUpdateInput) =>
      apiFetch<VendorEsgUpdateResponse>(`/vendors/${id}/esg`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    getDiversitySummary: () => apiFetch<VendorDiversitySummary>('/vendors/diversity/summary'),
    onboardingQuestionnaires: () => apiFetch<any[]>('/vendors/onboarding/questionnaires'),
    createOnboardingQuestionnaire: (data: unknown) =>
      apiFetch<any>('/vendors/onboarding/questionnaires', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onboardingQueue: () => apiFetch<any[]>('/vendors/onboarding/queue'),
    onboardingDetail: (id: string) => apiFetch<any>(`/vendors/${id}/onboarding`),
    reviewOnboarding: (
      id: string,
      data: { decision: 'approved' | 'changes_requested'; reviewNote?: string },
    ) =>
      apiFetch<any>(`/vendors/${id}/onboarding/review`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  users: {
    list: () => apiFetch<any[]>('/users'),
    get: (id: string) => apiFetch<any>(`/users/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    permissions: () => apiFetch<any[]>('/users/roles/permissions'),
    customRoles: () => apiFetch<any[]>('/users/roles/custom'),
    createCustomRole: (data: unknown) =>
      apiFetch<any>('/users/roles/custom', { method: 'POST', body: JSON.stringify(data) }),
    updateCustomRole: (id: string, data: unknown) =>
      apiFetch<any>(`/users/roles/custom/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteCustomRole: (id: string) =>
      apiFetch<void>(`/users/roles/custom/${id}`, { method: 'DELETE' }),
    addRole: (id: string, data: unknown) =>
      apiFetch<any>(`/users/${id}/roles`, { method: 'POST', body: JSON.stringify(data) }),
    removeRole: (id: string, roleId: string) =>
      apiFetch<void>(`/users/${id}/roles/${roleId}`, { method: 'DELETE' }),
    activate: (id: string) => apiFetch<any>(`/users/${id}/activate`, { method: 'PATCH' }),
    deactivate: (id: string) => apiFetch<any>(`/users/${id}/deactivate`, { method: 'PATCH' }),
  },
  departments: {
    list: () => apiFetch<any[]>('/departments'),
    get: (id: string) => apiFetch<any>(`/departments/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/departments', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/departments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => apiFetch<void>(`/departments/${id}`, { method: 'DELETE' }),
  },
  projects: {
    list: () => apiFetch<any[]>('/projects'),
    get: (id: string) => apiFetch<any>(`/projects/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/projects', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => apiFetch<void>(`/projects/${id}`, { method: 'DELETE' }),
  },
  webhooks: {
    list: () => apiFetch<any[]>('/webhooks'),
    get: (id: string) => apiFetch<any>(`/webhooks/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/webhooks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => apiFetch<void>(`/webhooks/${id}`, { method: 'DELETE' }),
    deliveries: (id: string) => apiFetch<any[]>(`/webhooks/${id}/deliveries`),
  },
  approvalRules: {
    list: () => apiFetch<any[]>(appendEntityId('/approval-rules')),
    get: (id: string) => apiFetch<any>(`/approval-rules/${id}`),
    simulate: (data: unknown) =>
      apiFetch<any>('/approval-rules/simulate', {
        method: 'POST',
        body: JSON.stringify(withEntityBody(data)),
      }),
    create: (data: unknown) =>
      apiFetch<any>('/approval-rules', {
        method: 'POST',
        body: JSON.stringify(withEntityBody(data)),
      }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/approval-rules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(withEntityBody(data)),
      }),
    remove: (id: string) => apiFetch<any>(`/approval-rules/${id}`, { method: 'DELETE' }),
  },
  catalog: {
    list: (params?: { vendorId?: string; category?: string; activeOnly?: boolean }) => {
      const q = new URLSearchParams();
      if (params?.vendorId) q.set('vendorId', params.vendorId);
      if (params?.category) q.set('category', params.category);
      if (params?.activeOnly) q.set('activeOnly', 'true');
      return apiFetch<any[]>(`/catalog-items${q.toString() ? '?' + q : ''}`);
    },
    search: (q: string) => apiFetch<any[]>(`/catalog-items/search?q=${encodeURIComponent(q)}`),
    categories: () => apiFetch<string[]>('/catalog-items/categories'),
    get: (id: string) => apiFetch<any>(`/catalog-items/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/catalog-items', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/catalog-items/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => apiFetch<void>(`/catalog-items/${id}`, { method: 'DELETE' }),
    priceProposals: (status?: string) =>
      apiFetch<any[]>(`/catalog-items/price-proposals${status ? `?status=${status}` : ''}`),
    reviewPriceProposal: (
      itemId: string,
      proposalId: string,
      data: { status: 'approved' | 'rejected'; reviewNote?: string },
    ) =>
      apiFetch<any>(`/catalog-items/${itemId}/price-proposals/${proposalId}/review`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },
  glMappings: {
    list: (targetSystem?: string) =>
      apiFetch<any[]>(`/gl/mappings${targetSystem ? '?targetSystem=' + targetSystem : ''}`),
    create: (data: unknown) =>
      apiFetch<any>('/gl/mappings', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/gl/mappings/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => apiFetch<void>(`/gl/mappings/${id}`, { method: 'DELETE' }),
  },
  glExportJobs: {
    list: () => apiFetch<any[]>('/gl/export-jobs'),
    forInvoice: (invoiceId: string) => apiFetch<any[]>(`/gl/export-jobs/invoice/${invoiceId}`),
    trigger: (invoiceId: string, targetSystem: string) =>
      apiFetch<any>(`/gl/export-jobs/trigger/${invoiceId}?targetSystem=${targetSystem}`, {
        method: 'POST',
      }),
    retry: (id: string) => apiFetch<any>(`/gl/export-jobs/${id}/retry`, { method: 'POST' }),
  },
  gl: {
    oauthStatus: () =>
      apiFetch<{
        qbo: boolean;
        xero: boolean;
        qboRealmId?: string;
        xeroTenantId?: string;
        qboConfigured: boolean;
        xeroConfigured: boolean;
        qboConnectionMode: 'platform';
        xeroConnectionMode: 'platform';
      }>('/gl/oauth/status'),
    oauthConnect: (provider: 'qbo' | 'xero') =>
      apiFetch<{ url: string }>(`/gl/oauth/${provider}/connect`),
    oauthDisconnect: (provider: 'qbo' | 'xero') =>
      apiFetch<void>(`/gl/oauth/${provider}`, { method: 'DELETE' }),
  },
  aiProviders: {
    status: () => apiFetch<AiProvidersStatusResponse>('/ai-providers/status'),
    saveApiKey: (
      provider: AiProviderId,
      data: { apiKey: string; defaultModel?: string; organizationId?: string; projectId?: string },
    ) =>
      apiFetch<AiProvidersStatusResponse>(`/ai-providers/${provider}/api-key`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    update: (
      provider: AiProviderId,
      data: { defaultModel?: string; enabled?: boolean; isDefault?: boolean },
    ) =>
      apiFetch<AiProvidersStatusResponse>(`/ai-providers/${provider}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    test: (provider: AiProviderId) =>
      apiFetch<{ ok: boolean; provider: AiProviderId; checkedAt: string }>(
        `/ai-providers/${provider}/test`,
        {
          method: 'POST',
        },
      ),
    openRouterConnect: () => apiFetch<{ url: string }>('/ai-providers/openrouter/oauth/connect'),
    disconnect: (provider: AiProviderId) =>
      apiFetch<AiProvidersStatusResponse>(`/ai-providers/${provider}`, { method: 'DELETE' }),
  },
  taxCodes: {
    list: () => apiFetch<any[]>('/tax-codes'),
    get: (id: string) => apiFetch<any>(`/tax-codes/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/tax-codes', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/tax-codes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => apiFetch<any>(`/tax-codes/${id}`, { method: 'DELETE' }),
  },
  requisitions: {
    list: () => apiFetch<any[]>('/requisitions'),
    get: (id: string) => apiFetch<any>(`/requisitions/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/requisitions', { method: 'POST', body: JSON.stringify(data) }),
    aiParse: (text: string) =>
      apiFetch<AiRequisitionParseResponse>('/requisitions/ai-parse', {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    submit: (id: string) => apiFetch<any>(`/requisitions/${id}/submit`, { method: 'POST' }),
    cancel: (id: string) => apiFetch<any>(`/requisitions/${id}/cancel`, { method: 'POST' }),
  },
  concierge: {
    policies: () => apiFetch<any[]>('/intake/concierge/policies'),
    createPolicy: (data: unknown) =>
      apiFetch<any>('/intake/concierge/policies', { method: 'POST', body: JSON.stringify(data) }),
    updatePolicy: (id: string, data: unknown) =>
      apiFetch<any>(`/intake/concierge/policies/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    createSession: (text: string) =>
      apiFetch<any>('/intake/concierge/sessions', {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    getSession: (id: string) => apiFetch<any>(`/intake/concierge/sessions/${id}`),
    addMessage: (id: string, message: string) =>
      apiFetch<any>(`/intake/concierge/sessions/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
    convert: (
      id: string,
      data?: {
        workflow?: 'requisition' | 'rfq' | 'vendor_onboarding' | 'software_license';
        acceptedValues?: Record<string, unknown>;
      },
    ) =>
      apiFetch<any>(`/intake/concierge/sessions/${id}/convert`, {
        method: 'POST',
        body: JSON.stringify(data ?? {}),
      }),
  },
  purchaseOrders: {
    list: () => apiFetch<any[]>(appendEntityId('/purchase-orders')),
    get: (id: string) => apiFetch<any>(`/purchase-orders/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/purchase-orders', {
        method: 'POST',
        body: JSON.stringify(withEntityBody(data)),
      }),
    issue: (id: string) => apiFetch<any>(`/purchase-orders/${id}/issue`, { method: 'POST' }),
    cancel: (id: string) => apiFetch<any>(`/purchase-orders/${id}/cancel`, { method: 'POST' }),
    changeOrder: (id: string, data: unknown) =>
      apiFetch<any>(`/purchase-orders/${id}/change-order`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    versions: (id: string) => apiFetch<any[]>(`/purchase-orders/${id}/versions`),
    releases: (id: string) => apiFetch<any[]>(`/purchase-orders/${id}/releases`),
    createRelease: (id: string, data: { amount: number; description?: string }) =>
      apiFetch<any>(`/purchase-orders/${id}/releases`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    cancelRelease: (id: string, releaseId: string) =>
      apiFetch<any>(`/purchase-orders/${id}/releases/${releaseId}`, { method: 'DELETE' }),
    receivingSummary: (id: string) => apiFetch<any[]>(`/purchase-orders/${id}/receiving-summary`),
    complianceReport: (id: string) => apiFetch<any>(`/purchase-orders/${id}/compliance-report`),
    checkCompliance: (data: {
      vendorId: string;
      unitPrice: number;
      catalogItemId?: string;
      description?: string;
    }) =>
      apiFetch<any>('/purchase-orders/check-compliance', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    pdf: (id: string) => {
      const token = getCookie('bs_token');
      return fetch(apiUrl(`/api/v1/purchase-orders/${id}/pdf`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    },
  },
  invoices: {
    list: () => apiFetch<any[]>(appendEntityId('/invoices')),
    get: (id: string) => apiFetch<any>(`/invoices/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/invoices', { method: 'POST', body: JSON.stringify(withEntityBody(data)) }),
    approve: (id: string) => apiFetch<any>(`/invoices/${id}/approve`, { method: 'PATCH' }),
    resolveException: (id: string, data?: { reason?: string }) =>
      apiFetch<any>(`/invoices/${id}/resolve-exception`, {
        method: 'PATCH',
        body: JSON.stringify(data ?? {}),
      }),
    bulkApprove: (ids: string[]) =>
      apiFetch<any[]>('/invoices/bulk-approve', { method: 'POST', body: JSON.stringify({ ids }) }),
    markPaid: (
      id: string,
      data: { paymentReference: string; paymentDate: string; paymentMethod: string },
    ) =>
      apiFetch<any>(`/invoices/${id}/mark-paid`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    rerunMatch: (id: string) => apiFetch<any>(`/invoices/${id}/match`, { method: 'POST' }),
    aging: () => apiFetch<any>('/invoices/aging'),
    cashFlowForecast: () => apiFetch<any[]>('/invoices/cash-flow-forecast'),
    earlyPaymentOpportunities: () => apiFetch<any[]>('/invoices/early-payment-opportunities'),
  },
  paymentRuns: {
    list: (params?: { status?: string }) =>
      apiFetch<any[]>(
        `/payment-runs${params?.status ? `?status=${encodeURIComponent(params.status)}` : ''}`,
      ),
    get: (id: string) => apiFetch<any>(`/payment-runs/${id}`),
    summary: () => apiFetch<any>('/payment-runs/summary'),
    eligibleInvoices: () => apiFetch<any[]>('/payment-runs/eligible-invoices'),
    create: (data: {
      invoiceIds: string[];
      paymentMethod?: string;
      invoiceMethods?: Record<string, string>;
      scheduledDate?: string;
      entityId?: string | null;
      notes?: string;
    }) =>
      apiFetch<any>('/payment-runs', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    approve: (id: string) => apiFetch<any>(`/payment-runs/${id}/approve`, { method: 'PATCH' }),
    submit: (id: string, data?: { providerBatchId?: string; paymentReference?: string }) =>
      apiFetch<any>(`/payment-runs/${id}/submit`, {
        method: 'PATCH',
        body: JSON.stringify(data ?? {}),
      }),
    cancel: (id: string, data?: { reason?: string }) =>
      apiFetch<any>(`/payment-runs/${id}/cancel`, {
        method: 'PATCH',
        body: JSON.stringify(data ?? {}),
      }),
    vendorAccounts: (vendorId?: string) =>
      apiFetch<any[]>(
        `/payment-runs/vendor-accounts${vendorId ? `?vendorId=${encodeURIComponent(vendorId)}` : ''}`,
      ),
    createVendorAccount: (data: unknown) =>
      apiFetch<any>('/payment-runs/vendor-accounts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    verifyVendorAccount: (id: string) =>
      apiFetch<any>(`/payment-runs/vendor-accounts/${id}/verify`, { method: 'PATCH' }),
  },
  approvals: {
    list: () => apiFetch<any[]>('/approvals'),
    get: (id: string) => apiFetch<any>(`/approvals/${id}`),
    approve: (id: string, data: unknown) =>
      apiFetch<any>(`/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),
    reject: (id: string, data: unknown) =>
      apiFetch<any>(`/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify(data) }),
    autoApprovedSummary: () =>
      apiFetch<{ count: number; totalAmount: number }>('/approvals/auto-approved-summary'),
  },
  receiving: {
    list: () => apiFetch<ReceivingListItem[]>('/receiving'),
    get: (id: string) => apiFetch<ReceivingDetail>(`/receiving/${id}`),
    create: (data: unknown) =>
      apiFetch<ReceivingDetail>('/receiving', { method: 'POST', body: JSON.stringify(data) }),
    confirm: (id: string) =>
      apiFetch<ReceivingDetail>(`/receiving/${id}/confirm`, { method: 'PATCH' }),
    cancel: (id: string) =>
      apiFetch<ReceivingDetail>(`/receiving/${id}/cancel`, { method: 'PATCH' }),
  },
  budgets: {
    list: () => apiFetch<any[]>(appendEntityId('/budgets')),
    get: (id: string) => apiFetch<any>(`/budgets/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/budgets', { method: 'POST', body: JSON.stringify(withEntityBody(data)) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/budgets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(withEntityBody(data)),
      }),
    addPeriod: (
      id: string,
      data: { periodStart: string; periodEnd: string; allocatedAmount: number },
    ) => apiFetch<any>(`/budgets/${id}/periods`, { method: 'POST', body: JSON.stringify(data) }),
    removePeriod: (id: string, periodId: string) =>
      apiFetch<any>(`/budgets/${id}/periods/${periodId}`, { method: 'DELETE' }),
    forecast: (fiscalYear?: number) =>
      apiFetch<any[]>(
        appendEntityId('/budgets/forecast' + (fiscalYear ? `?fiscalYear=${fiscalYear}` : '')),
      ),
    forecastSummary: (fiscalYear?: number) =>
      apiFetch<any>(
        appendEntityId(
          '/budgets/forecast/summary' + (fiscalYear ? `?fiscalYear=${fiscalYear}` : ''),
        ),
      ),
  },
  audit: {
    list: (params?: { entityType?: string; entityId?: string; limit?: number }) => {
      const q = new URLSearchParams();
      if (params?.entityType) q.set('entityType', params.entityType);
      if (params?.entityId) q.set('entityId', params.entityId);
      if (params?.limit) q.set('limit', String(params.limit));
      return apiFetch<any[]>(`/audit${q.toString() ? '?' + q : ''}`);
    },
  },
  compliance: {
    previewAuditPackage: (params?: { framework?: string; from?: string; to?: string }) => {
      const q = new URLSearchParams();
      if (params?.framework) q.set('framework', params.framework);
      if (params?.from) q.set('from', params.from);
      if (params?.to) q.set('to', params.to);
      return apiFetch<any>(`/compliance/audit-package/preview${q.toString() ? '?' + q : ''}`);
    },
    downloadAuditPackage: (data: { framework?: string; from?: string; to?: string }) => {
      const token = getCookie('bs_token');
      return fetch(apiUrl('/api/v1/compliance/audit-package'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      });
    },
    gdprExport: (userId: string) => apiFetch<any>(`/compliance/gdpr/export/${userId}`),
    gdprDelete: (userId: string) =>
      apiFetch<any>(`/compliance/gdpr/delete/${userId}`, { method: 'POST' }),
  },
  reports: {
    download: (type: string, params?: Record<string, string>) => {
      const q = new URLSearchParams(params ?? {});
      const token = getCookie('bs_token');
      const url = apiUrl(`/api/v1/reports/${type}${q.toString() ? '?' + q : ''}`);
      return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    },
    customReport: (params: {
      reportType: string;
      startDate?: string;
      endDate?: string;
      groupBy?: string;
    }) => {
      const filtered: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) {
        if (v) filtered[k] = v;
      }
      return apiFetch<any[]>('/reports/custom?' + new URLSearchParams(filtered));
    },
    customReportCsv: (params: {
      reportType: string;
      startDate?: string;
      endDate?: string;
      groupBy?: string;
    }) => {
      const filtered: Record<string, string> = { format: 'csv' };
      for (const [k, v] of Object.entries(params)) {
        if (v) filtered[k] = v;
      }
      const token = getCookie('bs_token');
      const url = apiUrl(`/api/v1/reports/custom?${new URLSearchParams(filtered)}`);
      return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    },
    savedReports: {
      list: () => apiFetch<any[]>('/reports/saved'),
      save: (data: unknown) =>
        apiFetch<any>('/reports/saved', { method: 'POST', body: JSON.stringify(data) }),
      delete: (id: string) => apiFetch<void>(`/reports/saved/${id}`, { method: 'DELETE' }),
    },
  },
  auth: {
    changePassword: (data: { currentPassword: string; newPassword: string }) => {
      const token = getCookie('bs_token');
      return fetch(apiUrl('/api/auth/change-password'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      });
    },
  },
  ocr: {
    list: () => apiFetch<any[]>('/ocr/jobs'),
    createJob: (data: unknown) =>
      apiFetch<any>('/ocr/jobs', { method: 'POST', body: JSON.stringify(data) }),
    getJob: (id: string) => apiFetch<any>(`/ocr/jobs/${id}`),
    linkToInvoice: (jobId: string, invoiceId: string) =>
      apiFetch<any>(`/ocr/jobs/${jobId}/link/${invoiceId}`, { method: 'POST' }),
  },
  punchout: {
    getSession: (token: string) => apiFetch<any>(`/punchout/session/${token}`),
    orderReturn: (session: string, data: unknown) =>
      apiFetch<any>(`/punchout/return?session=${session}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  analytics: {
    kpis: () => apiFetch<any>('/analytics/kpis'),
    spendByVendor: () => apiFetch<any[]>('/analytics/spend/by-vendor'),
    spendByDepartment: () => apiFetch<any[]>('/analytics/spend/by-department'),
    monthlySpend: () => apiFetch<any[]>('/analytics/spend/monthly'),
    invoiceAging: () => apiFetch<any[]>('/analytics/invoice-aging'),
    poCycleTime: () => apiFetch<any>('/analytics/po-cycle-time'),
    pendingItems: () => apiFetch<any>('/analytics/pending-items'),
    recentActivity: () => apiFetch<any[]>('/analytics/recent-activity'),
    vendorPerformance: () => apiFetch<any[]>('/analytics/vendor-performance'),
    budgetUtilization: () => apiFetch<any[]>('/analytics/budget-utilization'),
    spendByCategory: () => apiFetch<any[]>('/analytics/spend/by-category'),
    spendAnomalies: () => apiFetch<any[]>('/analytics/spend/anomalies'),
    categoryTrend: () => apiFetch<any[]>('/analytics/spend/category-trend'),
  },
  search: {
    query: (q: string) => apiFetch<any>(`/search?q=${encodeURIComponent(q)}`),
  },
  documents: {
    list: (params?: { entityType?: string; entityId?: string }) => {
      const q = new URLSearchParams();
      if (params?.entityType) q.set('entityType', params.entityType);
      if (params?.entityId) q.set('entityId', params.entityId);
      return apiFetch<any[]>(`/documents${q.toString() ? '?' + q : ''}`);
    },
  },
  contracts: {
    list: (params?: { status?: string; vendorId?: string; type?: string }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.vendorId) q.set('vendorId', params.vendorId);
      if (params?.type) q.set('type', params.type);
      return apiFetch<any[]>(`/contracts${q.toString() ? '?' + q : ''}`);
    },
    get: (id: string) => apiFetch<any>(`/contracts/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/contracts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/contracts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    activate: (id: string) => apiFetch<any>(`/contracts/${id}/activate`, { method: 'POST' }),
    terminate: (id: string, reason: string) =>
      apiFetch<any>(`/contracts/${id}/terminate`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    addLine: (id: string, data: unknown) =>
      apiFetch<any>(`/contracts/${id}/lines`, { method: 'POST', body: JSON.stringify(data) }),
    addAmendment: (id: string, data: unknown) =>
      apiFetch<any>(`/contracts/${id}/amendments`, { method: 'POST', body: JSON.stringify(data) }),
    expiring: (days?: number) =>
      apiFetch<any[]>(`/contracts/expiring${days ? '?days=' + days : ''}`),
    extractIntelligence: (
      id: string,
      data?: { documentText?: string; documentId?: string; sourceName?: string },
    ) =>
      apiFetch<any>(`/contracts/${id}/intelligence/extract`, {
        method: 'POST',
        body: JSON.stringify(data ?? {}),
      }),
    reviewExtraction: (
      id: string,
      extractionId: string,
      data: { decision: 'approved' | 'rejected'; fields?: Record<string, unknown> },
    ) =>
      apiFetch<any>(`/contracts/${id}/intelligence/extractions/${extractionId}/review`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateClause: (id: string, clauseId: string, data: unknown) =>
      apiFetch<any>(`/contracts/${id}/intelligence/clauses/${clauseId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    updateObligation: (id: string, obligationId: string, data: unknown) =>
      apiFetch<any>(`/contracts/${id}/intelligence/obligations/${obligationId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },
  softwareLicenses: {
    list: (params?: { status?: string; vendorId?: string; renewingWithinDays?: number }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.vendorId) q.set('vendorId', params.vendorId);
      if (params?.renewingWithinDays)
        q.set('renewingWithinDays', String(params.renewingWithinDays));
      return apiFetch<any[]>(`/software-licenses${q.toString() ? '?' + q : ''}`);
    },
    get: (id: string) => apiFetch<any>(`/software-licenses/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/software-licenses', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/software-licenses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    renewalAction: (
      id: string,
      data: { action: 'renew' | 'renegotiate' | 'cancel'; note?: string },
    ) =>
      apiFetch<any>(`/software-licenses/${id}/renewal-action`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    renewalCalendar: (days?: number) =>
      apiFetch<any[]>(`/software-licenses/renewal-calendar${days ? `?days=${days}` : ''}`),
    utilization: () => apiFetch<any[]>('/software-licenses/utilization'),
  },
  messages: {
    list: (threadType: MessageThreadType, threadId: string) =>
      apiFetch<unknown>(`/messages/${threadType}/${threadId}`).then((value) =>
        messageSchema.array().parse(value),
      ),
    post: (
      threadType: MessageThreadType,
      threadId: string,
      body: string,
      recipientVendorId?: string,
    ) =>
      apiFetch<unknown>(`/messages/${threadType}/${threadId}`, {
        method: 'POST',
        body: JSON.stringify({ body, ...(recipientVendorId ? { recipientVendorId } : {}) }),
      }).then((value) => messageSchema.parse(value)),
  },
  passwordReset: {
    request: (email: string) =>
      apiFetch<{ success: boolean }>('/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    reset: (token: string, password: string) =>
      apiFetch<{ success: boolean }>('/password-reset/reset', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      }),
  },
  vendorPortal: {
    sendAccess: (vendorId: string) =>
      apiFetch<{ success: boolean }>('/vendor-portal/access', {
        method: 'POST',
        body: JSON.stringify({ vendorId }),
      }),
    exchangeSession: (token: string) =>
      vendorPortalFetch<{ success: boolean }>('/vendor-portal/session', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    revokeSession: () =>
      vendorPortalFetch<{ success: boolean }>('/vendor-portal/session/revoke', {
        method: 'POST',
      }),
    dashboard: () => vendorPortalFetch<any>('/vendor-portal/dashboard'),
    getPo: (poId: string) => vendorPortalFetch<any>(`/vendor-portal/po/${poId}`),
    submitInvoice: (data: any) =>
      vendorPortalFetch<any>('/vendor-portal/invoice', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    listInvoices: () => vendorPortalFetch<any[]>('/vendor-portal/invoices'),
    catalog: () => vendorPortalFetch<any>('/vendor-portal/catalog'),
    onboarding: () => vendorPortalFetch<any>('/vendor-portal/onboarding'),
    submitOnboarding: (data: unknown) =>
      vendorPortalFetch<any>('/vendor-portal/onboarding', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    submitPriceProposal: (data: any) =>
      vendorPortalFetch<any>('/vendor-portal/catalog/price-proposals', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    submitBulkPriceProposals: (
      rows: Array<{
        itemId?: string;
        sku?: string;
        proposedPrice: number;
        effectiveDate?: string;
        note?: string;
      }>,
    ) =>
      vendorPortalFetch<any>('/vendor-portal/catalog/price-proposals/bulk', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      }),
    listMessages: (threadType: MessageThreadType, threadId: string) =>
      vendorPortalFetch<unknown>(`/vendor-portal/messages/${threadType}/${threadId}`).then(
        (value) => messageSchema.array().parse(value),
      ),
    postMessage: (threadType: MessageThreadType, threadId: string, body: string) =>
      vendorPortalFetch<unknown>(`/vendor-portal/messages/${threadType}/${threadId}`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }).then((value) => messageSchema.parse(value)),
  },
  riskScreening: {
    list: () =>
      apiFetch<unknown>('/risk-screening').then((value) =>
        vendorScreeningStatusSchema.array().parse(value),
      ),
    screenVendor: (vendorId: string) =>
      apiFetch<unknown>(`/risk-screening/vendors/${vendorId}/screen`, {
        method: 'POST',
      }).then((value) => vendorScreeningResultSchema.parse(value)),
    screenAll: () =>
      apiFetch<unknown>('/risk-screening/screen-all', { method: 'POST' }).then((value) =>
        screenAllVendorsResultSchema.parse(value),
      ),
    manualReview: (vendorId: string, note: string) =>
      apiFetch<unknown>(`/risk-screening/vendors/${vendorId}/manual-review`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }).then((value) => vendorScreeningStatusSchema.parse(value)),
    ingest: (source?: string) =>
      apiFetch<unknown>('/risk-screening/ingest', {
        method: 'POST',
        body: JSON.stringify(source ? { source } : {}),
      }).then((value) => sanctionsIngestResultSchema.parse(value)),
  },
  notifications: {
    list: (params?: {
      unreadOnly?: boolean;
      limit?: number;
      offset?: number;
      type?: string;
      status?: 'all' | 'read' | 'unread';
      sort?: 'newest' | 'oldest';
    }) => {
      const q = new URLSearchParams();
      if (params?.unreadOnly) q.set('unreadOnly', 'true');
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      if (params?.type && params.type !== 'all') q.set('type', params.type);
      if (params?.status && params.status !== 'all') q.set('status', params.status);
      if (params?.sort) q.set('sort', params.sort);
      return apiFetch<{ items: any[]; total: number; limit: number; offset: number }>(
        `/notifications${q.toString() ? '?' + q : ''}`,
      );
    },
    types: () => apiFetch<string[]>('/notifications/types'),
    getPreferences: () =>
      apiFetch<{
        emailEnabled: boolean;
        frequency: 'instant' | 'daily' | 'weekly';
        enabledTypes: string[];
      }>('/notifications/preferences'),
    updatePreferences: (data: {
      emailEnabled?: boolean;
      frequency?: 'instant' | 'daily' | 'weekly';
      enabledTypes?: string[];
    }) =>
      apiFetch<{
        emailEnabled: boolean;
        frequency: 'instant' | 'daily' | 'weekly';
        enabledTypes: string[];
      }>('/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    unreadCount: () => apiFetch<{ count: number }>('/notifications/unread-count'),
    markRead: (id: string) => apiFetch<void>(`/notifications/${id}/read`, { method: 'POST' }),
    markAllRead: () => apiFetch<void>('/notifications/read-all', { method: 'POST' }),
  },
  emailIntake: {
    list: () => apiFetch<any[]>('/email-intake'),
    create: (data: { sourceEmail: string; subject: string; body: string }) =>
      apiFetch<any>('/email-intake', { method: 'POST', body: JSON.stringify(data) }),
    discard: (id: string) => apiFetch<any>(`/email-intake/${id}/discard`, { method: 'POST' }),
  },
  settings: {
    getAll: () => apiFetch<Record<string, string>>('/settings'),
    getBranding: () => apiFetch<Record<string, string>>('/settings/branding'),
    updateBranding: (data: unknown) =>
      apiFetch<any>('/settings/branding', { method: 'PUT', body: JSON.stringify(data) }),
    updateSmtp: (data: unknown) =>
      apiFetch<any>('/settings/smtp', { method: 'PUT', body: JSON.stringify(data) }),
    updateContractCompliance: (data: unknown) =>
      apiFetch<any>('/settings/contract-compliance', { method: 'PUT', body: JSON.stringify(data) }),
    updateApprovalPolicy: (data: unknown) =>
      apiFetch<any>('/settings/approval-policy', { method: 'PUT', body: JSON.stringify(data) }),
  },
  supplierScorecard: {
    list: (params?: { limit?: number }) =>
      apiFetch<any[]>('/supplier-scorecard' + (params?.limit ? `?limit=${params.limit}` : '')),
    get: (vendorId: string) => apiFetch<any>(`/supplier-scorecard/${vendorId}`),
  },
  approvalDelegations: {
    list: () => apiFetch<any[]>('/approval-delegations'),
    my: () => apiFetch<any[]>('/approval-delegations/my'),
    delegateForMe: () => apiFetch<any[]>('/approval-delegations/delegate-for-me'),
    create: (data: unknown) =>
      apiFetch<any>('/approval-delegations', { method: 'POST', body: JSON.stringify(data) }),
    cancel: (id: string) => apiFetch<void>(`/approval-delegations/${id}`, { method: 'DELETE' }),
  },
  rfq: {
    list: () => apiFetch<any[]>('/rfq'),
    get: (id: string) => apiFetch<any>(`/rfq/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/rfq', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/rfq/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    open: (id: string) => apiFetch<any>(`/rfq/${id}/open`, { method: 'POST' }),
    close: (id: string) => apiFetch<any>(`/rfq/${id}/close`, { method: 'POST' }),
    award: (id: string, responseId: string) =>
      apiFetch<any>(`/rfq/${id}/award`, { method: 'POST', body: JSON.stringify({ responseId }) }),
    reject: (id: string, responseId: string, reason: string) =>
      apiFetch<any>(`/rfq/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ responseId, reason }),
      }),
    submitResponse: (id: string, data: unknown) =>
      apiFetch<any>(`/rfq/${id}/responses`, { method: 'POST', body: JSON.stringify(data) }),
  },
  recurringPo: {
    list: () => apiFetch<any[]>('/recurring-po'),
    get: (id: string) => apiFetch<any>(`/recurring-po/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/recurring-po', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/recurring-po/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => apiFetch<void>(`/recurring-po/${id}`, { method: 'DELETE' }),
    run: (id: string) => apiFetch<any>(`/recurring-po/${id}/run`, { method: 'POST' }),
    skipNext: (id: string) => apiFetch<any>(`/recurring-po/${id}/skip-next`, { method: 'POST' }),
  },
  inventory: {
    list: (params?: { lowStockOnly?: boolean }) =>
      apiFetch<any[]>(`/inventory${params?.lowStockOnly ? '?lowStockOnly=true' : ''}`),
    lowStock: () => apiFetch<any[]>('/inventory/low-stock'),
    get: (id: string) => apiFetch<any>(`/inventory/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/inventory', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/inventory/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    adjust: (id: string, data: { quantity: number; notes?: string }) =>
      apiFetch<any>(`/inventory/${id}/adjust`, { method: 'POST', body: JSON.stringify(data) }),
  },
  export: {
    download: (type: string, params?: { from?: string; to?: string }) => {
      const q = new URLSearchParams({ format: 'csv', ...(params ?? {}) });
      const token = getCookie('bs_token');
      const url = apiUrl(`/api/v1/export/${type}?${q}`);
      return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    },
    json: (
      type: string,
      params?: { from?: string; to?: string; page?: number; limit?: number },
    ) => {
      const filtered: Record<string, string> = {};
      if (params?.from) filtered.from = params.from;
      if (params?.to) filtered.to = params.to;
      if (params?.page) filtered.page = String(params.page);
      if (params?.limit) filtered.limit = String(params.limit);
      return apiFetch<any>(`/export/${type}?` + new URLSearchParams(filtered));
    },
  },
  requisitionTemplates: {
    list: () => apiFetch<any[]>('/requisition-templates'),
    get: (id: string) => apiFetch<any>(`/requisition-templates/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/requisition-templates', { method: 'POST', body: JSON.stringify(data) }),
    createFromRequisition: (requisitionId: string, data: unknown) =>
      apiFetch<any>(`/requisition-templates/from-requisition/${requisitionId}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/requisition-templates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    remove: (id: string) => apiFetch<void>(`/requisition-templates/${id}`, { method: 'DELETE' }),
    apply: (id: string) => apiFetch<any>(`/requisition-templates/${id}/apply`),
  },
};
