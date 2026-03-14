const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001';
const ENTITY_STORAGE_KEY = 'betterspend:selected-entity-id';

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
    window.location.href = '/login';
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
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
    ...options,
  });

  if (res.status === 401) {
    clearAuthAndRedirect();
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

async function apiFetchForm<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getCookie('bs_token');
  const headers = new Headers(options?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    clearAuthAndRedirect();
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
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
      apiFetch<{ success: boolean; pendingEmail: string; pendingEmailExpiresAt: string }>('/account/me/email/change-request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
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
    check: () => apiFetch<{ status: string; timestamp: string; service: string; version: string }>('/health'),
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
    updateEsg: (id: string, data: unknown) =>
      apiFetch<any>(`/vendors/${id}/esg`, { method: 'PATCH', body: JSON.stringify(data) }),
    diversitySummary: () => apiFetch<any>('/vendors/diversity/summary'),
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
      }>(
        '/gl/oauth/status',
      ),
    oauthConnect: (provider: 'qbo' | 'xero') =>
      apiFetch<{ url: string }>(`/gl/oauth/${provider}/connect`),
    oauthDisconnect: (provider: 'qbo' | 'xero') =>
      apiFetch<void>(`/gl/oauth/${provider}`, { method: 'DELETE' }),
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
      apiFetch<any>('/requisitions/ai-parse', { method: 'POST', body: JSON.stringify({ text }) }),
    submit: (id: string) => apiFetch<any>(`/requisitions/${id}/submit`, { method: 'POST' }),
    cancel: (id: string) => apiFetch<any>(`/requisitions/${id}/cancel`, { method: 'POST' }),
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
      return fetch(`${API_BASE}/api/v1/purchase-orders/${id}/pdf`, {
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
    markPaid: (id: string, data?: { paymentReference?: string }) =>
      apiFetch<any>(`/invoices/${id}/mark-paid`, {
        method: 'PATCH',
        body: JSON.stringify(data ?? {}),
      }),
    rerunMatch: (id: string) => apiFetch<any>(`/invoices/${id}/match`, { method: 'POST' }),
    aging: () => apiFetch<any>('/invoices/aging'),
    cashFlowForecast: () => apiFetch<any[]>('/invoices/cash-flow-forecast'),
    earlyPaymentOpportunities: () => apiFetch<any[]>('/invoices/early-payment-opportunities'),
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
    list: () => apiFetch<any[]>('/receiving'),
    get: (id: string) => apiFetch<any>(`/receiving/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/receiving', { method: 'POST', body: JSON.stringify(data) }),
    confirm: (id: string) => apiFetch<any>(`/receiving/${id}/confirm`, { method: 'PATCH' }),
    cancel: (id: string) => apiFetch<any>(`/receiving/${id}/cancel`, { method: 'PATCH' }),
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
  reports: {
    download: (type: string, params?: Record<string, string>) => {
      const q = new URLSearchParams(params ?? {});
      const token = getCookie('bs_token');
      const url = `${API_BASE}/api/v1/reports/${type}${q.toString() ? '?' + q : ''}`;
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
      const url = `${API_BASE}/api/v1/reports/custom?` + new URLSearchParams(filtered);
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
      return fetch(`${API_BASE}/api/auth/change-password`, {
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
  },
  softwareLicenses: {
    list: (params?: { status?: string; vendorId?: string; renewingWithinDays?: number }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.vendorId) q.set('vendorId', params.vendorId);
      if (params?.renewingWithinDays) q.set('renewingWithinDays', String(params.renewingWithinDays));
      return apiFetch<any[]>(`/software-licenses${q.toString() ? '?' + q : ''}`);
    },
    get: (id: string) => apiFetch<any>(`/software-licenses/${id}`),
    create: (data: unknown) =>
      apiFetch<any>('/software-licenses', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      apiFetch<any>(`/software-licenses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    renewalAction: (id: string, data: { action: 'renew' | 'renegotiate' | 'cancel'; note?: string }) =>
      apiFetch<any>(`/software-licenses/${id}/renewal-action`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    renewalCalendar: (days?: number) =>
      apiFetch<any[]>(`/software-licenses/renewal-calendar${days ? `?days=${days}` : ''}`),
    utilization: () => apiFetch<any[]>('/software-licenses/utilization'),
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
    dashboard: (token: string) =>
      apiFetch<any>(`/vendor-portal/dashboard?token=${encodeURIComponent(token)}`),
    getPo: (poId: string, token: string) =>
      apiFetch<any>(`/vendor-portal/po/${poId}?token=${encodeURIComponent(token)}`),
    submitInvoice: (token: string, data: any) =>
      apiFetch<any>(`/vendor-portal/invoice?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    listInvoices: (token: string) =>
      apiFetch<any[]>(`/vendor-portal/invoices?token=${encodeURIComponent(token)}`),
    catalog: (token: string) =>
      apiFetch<any>(`/vendor-portal/catalog?token=${encodeURIComponent(token)}`),
    onboarding: (token: string) =>
      apiFetch<any>(`/vendor-portal/onboarding?token=${encodeURIComponent(token)}`),
    submitOnboarding: (token: string, data: unknown) =>
      apiFetch<any>(`/vendor-portal/onboarding?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    submitPriceProposal: (token: string, data: any) =>
      apiFetch<any>(`/vendor-portal/catalog/price-proposals?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    submitBulkPriceProposals: (
      token: string,
      rows: Array<{ itemId?: string; sku?: string; proposedPrice: number; effectiveDate?: string; note?: string }>,
    ) =>
      apiFetch<any>(`/vendor-portal/catalog/price-proposals/bulk?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify({ rows }),
      }),
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
      return apiFetch<{ items: any[]; total: number; limit: number; offset: number }>(`/notifications${q.toString() ? '?' + q : ''}`);
    },
    types: () => apiFetch<string[]>('/notifications/types'),
    getPreferences: () =>
      apiFetch<{ emailEnabled: boolean; frequency: 'instant' | 'daily' | 'weekly'; enabledTypes: string[] }>('/notifications/preferences'),
    updatePreferences: (data: { emailEnabled?: boolean; frequency?: 'instant' | 'daily' | 'weekly'; enabledTypes?: string[] }) =>
      apiFetch<{ emailEnabled: boolean; frequency: 'instant' | 'daily' | 'weekly'; enabledTypes: string[] }>('/notifications/preferences', {
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
      apiFetch<any>(`/rfq/${id}/reject`, { method: 'POST', body: JSON.stringify({ responseId, reason }) }),
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
      const url = `${API_BASE}/api/v1/export/${type}?${q}`;
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
