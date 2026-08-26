import type { PermissionKey } from '@betterspend/shared';

export const PRODUCT_NAV_SECTIONS = [
  { key: 'top-level', label: null, defaultOpen: true },
  { key: 'procurement', label: 'Procurement', defaultOpen: true },
  { key: 'operations', label: 'Operations', defaultOpen: true },
  { key: 'approvals', label: 'Approvals', defaultOpen: false },
  { key: 'finance', label: 'Finance', defaultOpen: false },
  { key: 'analytics', label: 'Analytics & Reports', defaultOpen: false },
  { key: 'supplier-operations', label: 'Supplier operations', defaultOpen: false },
  { key: 'organization', label: 'Organization', defaultOpen: false },
  { key: 'system', label: 'System', defaultOpen: false },
] as const;

export type ProductNavSectionKey = (typeof PRODUCT_NAV_SECTIONS)[number]['key'];

export type ProductRoutePlacement = 'primary' | 'search' | 'supplier-hub';

export type ProductRouteIcon =
  | 'Dashboard'
  | 'StartRequest'
  | 'Requisitions'
  | 'PurchaseOrders'
  | 'Rfq'
  | 'RecurringPos'
  | 'Catalog'
  | 'Receiving'
  | 'Inventory'
  | 'Invoices'
  | 'Intake'
  | 'Ocr'
  | 'Approvals'
  | 'ApprovalRules'
  | 'Delegations'
  | 'Budgets'
  | 'SpendGuard'
  | 'TaxCodes'
  | 'Currencies'
  | 'ApAging'
  | 'PaymentRuns'
  | 'GlIntegration'
  | 'Analytics'
  | 'Reports'
  | 'Suppliers'
  | 'Contracts'
  | 'SoftwareLicenses'
  | 'Users'
  | 'Departments'
  | 'Projects'
  | 'Entities'
  | 'Addons'
  | 'Webhooks'
  | 'AuditLog'
  | 'Compliance'
  | 'WorkspaceSettings';

export interface ProductRouteAction {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly aliases: readonly string[];
  readonly requiredPermissions: readonly PermissionKey[];
}

export interface ProductRoute {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly section: ProductNavSectionKey;
  readonly icon: ProductRouteIcon;
  readonly aliases: readonly string[];
  readonly requiredPermissions: readonly PermissionKey[];
  readonly placements: readonly ProductRoutePlacement[];
  readonly supplierHubLabel?: string;
  readonly actions?: readonly ProductRouteAction[];
}

const REQUISITION_PERMISSIONS = [
  'requisitions:view_own',
  'requisitions:view_all',
  'requisitions:manage',
] as const satisfies readonly PermissionKey[];

const PURCHASE_ORDER_PERMISSIONS = [
  'purchase_orders:view_own',
  'purchase_orders:view_all',
  'purchase_orders:manage',
  'purchase_orders:issue',
] as const satisfies readonly PermissionKey[];

const RECEIVING_PERMISSIONS = [
  'receiving:view',
  'receiving:manage',
] as const satisfies readonly PermissionKey[];

const INVOICE_PERMISSIONS = [
  'invoices:approve',
  'invoices:view_all',
  'invoices:manage',
] as const satisfies readonly PermissionKey[];

const VENDOR_PERMISSIONS = ['vendors:view'] as const satisfies readonly PermissionKey[];

const REPORT_PERMISSIONS = ['reports:view'] as const satisfies readonly PermissionKey[];

const BUDGET_PERMISSIONS = ['budgets:view'] as const satisfies readonly PermissionKey[];

const PAYMENT_PERMISSIONS = ['payments:view'] as const satisfies readonly PermissionKey[];

export const PRODUCT_ROUTES: readonly ProductRoute[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    href: '/',
    section: 'top-level',
    icon: 'Dashboard',
    aliases: ['home', 'overview'],
    requiredPermissions: [],
    placements: ['primary', 'search'],
  },
  {
    key: 'start-request',
    label: 'Start Request',
    href: '/start',
    section: 'procurement',
    icon: 'StartRequest',
    aliases: ['new request', 'create requisition'],
    requiredPermissions: ['requisitions:create'],
    placements: ['primary', 'search'],
  },
  {
    key: 'requisitions',
    label: 'Requisitions',
    href: '/requisitions',
    section: 'procurement',
    icon: 'Requisitions',
    aliases: ['requests', 'purchase requests'],
    requiredPermissions: REQUISITION_PERMISSIONS,
    placements: ['primary', 'search'],
    actions: [
      {
        key: 'create-requisition',
        label: 'Create requisition',
        href: '/requisitions/new',
        aliases: ['new request', 'new requisition'],
        requiredPermissions: ['requisitions:create'],
      },
    ],
  },
  {
    key: 'purchase-orders',
    label: 'Purchase Orders',
    href: '/purchase-orders',
    section: 'procurement',
    icon: 'PurchaseOrders',
    aliases: ['PO', 'POs', 'orders'],
    requiredPermissions: PURCHASE_ORDER_PERMISSIONS,
    placements: ['primary', 'search'],
    actions: [
      {
        key: 'create-purchase-order',
        label: 'Create purchase order',
        href: '/purchase-orders/new',
        aliases: ['new PO', 'create PO'],
        requiredPermissions: ['purchase_orders:create'],
      },
    ],
  },
  {
    key: 'rfq',
    label: 'RFQ / Sourcing',
    href: '/rfq',
    section: 'procurement',
    icon: 'Rfq',
    aliases: ['RFQ', 'request for quote', 'sourcing'],
    requiredPermissions: ['rfqs:view'],
    placements: ['primary', 'search'],
  },
  {
    key: 'recurring-purchase-orders',
    label: 'Recurring POs',
    href: '/recurring-po',
    section: 'procurement',
    icon: 'RecurringPos',
    aliases: ['recurring purchase orders', 'scheduled PO'],
    requiredPermissions: ['purchase_orders:view_all'],
    placements: ['primary', 'search'],
  },
  {
    key: 'catalog',
    label: 'Catalog',
    href: '/catalog',
    section: 'procurement',
    icon: 'Catalog',
    aliases: ['items', 'punchout'],
    requiredPermissions: ['catalog:view'],
    placements: ['primary', 'search'],
  },
  {
    key: 'receiving',
    label: 'Receiving',
    href: '/receiving',
    section: 'operations',
    icon: 'Receiving',
    aliases: ['goods receipts', 'GRN', 'receive PO', 'receive purchase order'],
    requiredPermissions: RECEIVING_PERMISSIONS,
    placements: ['primary', 'search'],
    actions: [
      {
        key: 'receive-purchase-order',
        label: 'Receive PO',
        href: '/receiving/new',
        aliases: ['receive purchase order', 'create goods receipt', 'new GRN'],
        requiredPermissions: ['receiving:create'],
      },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    href: '/inventory',
    section: 'operations',
    icon: 'Inventory',
    aliases: ['stock', 'warehouse'],
    requiredPermissions: ['inventory:view'],
    placements: ['primary', 'search'],
    actions: [
      {
        key: 'create-inventory-item',
        label: 'Create inventory item',
        href: '/inventory/new',
        aliases: ['new inventory item', 'new stock item'],
        requiredPermissions: ['inventory:manage'],
      },
    ],
  },
  {
    key: 'invoices',
    label: 'Invoices',
    href: '/invoices',
    section: 'operations',
    icon: 'Invoices',
    aliases: ['bills', 'AP invoices'],
    requiredPermissions: INVOICE_PERMISSIONS,
    placements: ['primary', 'search'],
    actions: [
      {
        key: 'create-invoice',
        label: 'Create invoice',
        href: '/invoices/new',
        aliases: ['new invoice', 'new bill'],
        requiredPermissions: ['invoices:create'],
      },
    ],
  },
  {
    key: 'intake-queue',
    label: 'Intake Queue',
    href: '/intake',
    section: 'operations',
    icon: 'Intake',
    aliases: ['email invoices', 'invoice email', 'inbound invoices'],
    requiredPermissions: ['invoices:manage'],
    placements: ['primary', 'search'],
    actions: [
      {
        key: 'email-invoices',
        label: 'Email invoices',
        href: '/intake',
        aliases: ['invoice email address', 'send invoice by email'],
        requiredPermissions: ['invoices:manage'],
      },
    ],
  },
  {
    key: 'ocr-jobs',
    label: 'OCR Jobs',
    href: '/ocr',
    section: 'operations',
    icon: 'Ocr',
    aliases: ['document extraction', 'invoice OCR'],
    requiredPermissions: ['invoices:manage'],
    placements: ['primary', 'search'],
  },
  {
    key: 'pending-approvals',
    label: 'Pending Approvals',
    href: '/approvals',
    section: 'approvals',
    icon: 'Approvals',
    aliases: ['approvals', 'approval inbox'],
    requiredPermissions: ['approvals:view'],
    placements: ['primary', 'search'],
  },
  {
    key: 'approval-rules',
    label: 'Approval Rules',
    href: '/approval-rules',
    section: 'approvals',
    icon: 'ApprovalRules',
    aliases: ['approval workflows', 'workflow rules'],
    requiredPermissions: ['settings:manage'],
    placements: ['primary', 'search'],
  },
  {
    key: 'approval-delegations',
    label: 'Delegations',
    href: '/approval-delegations',
    section: 'approvals',
    icon: 'Delegations',
    aliases: ['approval delegation', 'delegate approvals'],
    requiredPermissions: ['approvals:act'],
    placements: ['primary', 'search'],
  },
  {
    key: 'budgets',
    label: 'Budgets',
    href: '/budgets',
    section: 'finance',
    icon: 'Budgets',
    aliases: ['budget management'],
    requiredPermissions: BUDGET_PERMISSIONS,
    placements: ['primary', 'search'],
    actions: [
      {
        key: 'create-budget',
        label: 'Create budget',
        href: '/budgets/new',
        aliases: ['new budget'],
        requiredPermissions: ['budgets:manage'],
      },
    ],
  },
  {
    key: 'spend-guard',
    label: 'Spend Guard',
    href: '/spend-guard',
    section: 'finance',
    icon: 'SpendGuard',
    aliases: ['spend controls', 'spend alerts'],
    requiredPermissions: ['reports:view'],
    placements: ['primary', 'search'],
  },
  {
    key: 'tax-codes',
    label: 'Tax Codes',
    href: '/tax-codes',
    section: 'finance',
    icon: 'TaxCodes',
    aliases: ['tax settings'],
    requiredPermissions: ['reports:view'],
    placements: ['primary', 'search'],
  },
  {
    key: 'currencies',
    label: 'Currencies',
    href: '/currencies',
    section: 'finance',
    icon: 'Currencies',
    aliases: ['currency settings', 'exchange rates'],
    requiredPermissions: ['reports:view'],
    placements: ['primary', 'search'],
  },
  {
    key: 'ap-aging',
    label: 'AP Aging',
    href: '/ap-aging',
    section: 'finance',
    icon: 'ApAging',
    aliases: ['accounts payable aging', 'invoice aging'],
    requiredPermissions: ['reports:view'],
    placements: ['primary', 'search'],
  },
  {
    key: 'payment-runs',
    label: 'Payment Runs',
    href: '/payment-runs',
    section: 'finance',
    icon: 'PaymentRuns',
    aliases: ['pay bills', 'pay invoices', 'accounts payable'],
    requiredPermissions: PAYMENT_PERMISSIONS,
    placements: ['primary', 'search'],
    actions: [
      {
        key: 'pay-bills',
        label: 'Pay bills',
        href: '/payment-runs',
        aliases: ['create payment run', 'pay invoices'],
        requiredPermissions: ['payments:manage'],
      },
    ],
  },
  {
    key: 'gl-integration',
    label: 'GL Integration',
    href: '/gl-mappings',
    section: 'finance',
    icon: 'GlIntegration',
    aliases: ['GL mappings', 'general ledger', 'accounting integration'],
    requiredPermissions: ['reports:view'],
    placements: ['primary', 'search'],
  },
  {
    key: 'analytics',
    label: 'Analytics',
    href: '/analytics',
    section: 'analytics',
    icon: 'Analytics',
    aliases: ['spend analytics', 'metrics'],
    requiredPermissions: ['reports:view'],
    placements: ['primary', 'search'],
  },
  {
    key: 'reports',
    label: 'Reports',
    href: '/reports',
    section: 'analytics',
    icon: 'Reports',
    aliases: ['reporting', 'exports'],
    requiredPermissions: REPORT_PERMISSIONS,
    placements: ['primary', 'search'],
  },
  {
    key: 'suppliers',
    label: 'Suppliers',
    href: '/vendors',
    section: 'supplier-operations',
    icon: 'Suppliers',
    aliases: ['vendors', 'vendor management'],
    requiredPermissions: VENDOR_PERMISSIONS,
    placements: ['primary', 'search', 'supplier-hub'],
    supplierHubLabel: 'All suppliers',
    actions: [
      {
        key: 'create-vendor',
        label: 'Create vendor',
        href: '/vendors/new',
        aliases: ['new vendor', 'new supplier'],
        requiredPermissions: ['vendors:create'],
      },
    ],
  },
  {
    key: 'supplier-onboarding',
    label: 'Supplier onboarding',
    href: '/vendors/onboarding',
    section: 'supplier-operations',
    icon: 'Suppliers',
    aliases: ['vendor onboarding', 'onboarding queue'],
    requiredPermissions: ['vendors:view'],
    placements: ['search', 'supplier-hub'],
    supplierHubLabel: 'Onboarding',
  },
  {
    key: 'supplier-risk',
    label: 'Supplier Risk',
    href: '/risk-screening',
    section: 'supplier-operations',
    icon: 'SpendGuard',
    aliases: ['supplier risk', 'vendor risk', 'risk flags', 'sanctions screening'],
    requiredPermissions: ['supplier_risk:view'],
    placements: ['search', 'supplier-hub'],
    supplierHubLabel: 'Risk flags',
  },
  {
    key: 'supplier-scorecard',
    label: 'Supplier Scorecards',
    href: '/supplier-scorecard',
    section: 'supplier-operations',
    icon: 'Analytics',
    aliases: ['supplier performance', 'vendor performance', 'scorecards'],
    requiredPermissions: ['vendors:view'],
    placements: ['search', 'supplier-hub'],
    supplierHubLabel: 'Performance',
  },
  {
    key: 'supplier-diversity',
    label: 'Supplier Diversity',
    href: '/supplier-diversity',
    section: 'supplier-operations',
    icon: 'Compliance',
    aliases: ['vendor diversity', 'ESG', 'sustainability'],
    requiredPermissions: ['vendors:view'],
    placements: ['search', 'supplier-hub'],
    supplierHubLabel: 'Diversity',
  },
  {
    key: 'contracts',
    label: 'Contracts',
    href: '/contracts',
    section: 'supplier-operations',
    icon: 'Contracts',
    aliases: ['supplier contracts'],
    requiredPermissions: ['contracts:view'],
    placements: ['primary', 'search', 'supplier-hub'],
    supplierHubLabel: 'Contracts',
    actions: [
      {
        key: 'create-contract',
        label: 'Create contract',
        href: '/contracts/new',
        aliases: ['new contract'],
        requiredPermissions: ['contracts:manage'],
      },
    ],
  },
  {
    key: 'software-licenses',
    label: 'Software Licenses',
    href: '/software-licenses',
    section: 'supplier-operations',
    icon: 'SoftwareLicenses',
    aliases: ['software renewals', 'license management'],
    requiredPermissions: ['software_licenses:view'],
    placements: ['primary', 'search', 'supplier-hub'],
    supplierHubLabel: 'Software licenses',
  },
  {
    key: 'users',
    label: 'Users',
    href: '/users',
    section: 'organization',
    icon: 'Users',
    aliases: ['user management', 'roles'],
    requiredPermissions: ['users:manage'],
    placements: ['primary', 'search'],
  },
  {
    key: 'departments',
    label: 'Departments',
    href: '/departments',
    section: 'organization',
    icon: 'Departments',
    aliases: ['department settings'],
    requiredPermissions: ['reports:view'],
    placements: ['primary', 'search'],
  },
  {
    key: 'projects',
    label: 'Projects',
    href: '/projects',
    section: 'organization',
    icon: 'Projects',
    aliases: ['project settings'],
    requiredPermissions: ['reports:view'],
    placements: ['primary', 'search'],
  },
  {
    key: 'entities',
    label: 'Entities',
    href: '/entities',
    section: 'organization',
    icon: 'Entities',
    aliases: ['legal entities', 'business entities'],
    requiredPermissions: ['reports:view'],
    placements: ['primary', 'search'],
  },
  {
    key: 'addons',
    label: 'Add-ons',
    href: '/addons',
    section: 'system',
    icon: 'Addons',
    aliases: ['integrations', 'extensions'],
    requiredPermissions: ['settings:manage'],
    placements: ['primary', 'search'],
  },
  {
    key: 'webhooks',
    label: 'Webhooks',
    href: '/webhooks',
    section: 'system',
    icon: 'Webhooks',
    aliases: ['webhook settings'],
    requiredPermissions: ['settings:manage'],
    placements: ['primary', 'search'],
  },
  {
    key: 'audit-log',
    label: 'Audit Log',
    href: '/audit',
    section: 'system',
    icon: 'AuditLog',
    aliases: ['audit trail', 'activity log'],
    requiredPermissions: ['reports:view'],
    placements: ['primary', 'search'],
  },
  {
    key: 'compliance',
    label: 'Compliance',
    href: '/compliance',
    section: 'system',
    icon: 'Compliance',
    aliases: ['compliance settings'],
    requiredPermissions: ['settings:manage'],
    placements: ['primary', 'search'],
  },
  {
    key: 'workspace-settings',
    label: 'Workspace Settings',
    href: '/workspace-settings',
    section: 'system',
    icon: 'WorkspaceSettings',
    aliases: ['organization settings', 'workspace administration'],
    requiredPermissions: ['settings:manage'],
    placements: ['primary', 'search'],
  },
  {
    key: 'gl-export-jobs',
    label: 'GL Export Jobs',
    href: '/gl-export-jobs',
    section: 'finance',
    icon: 'GlIntegration',
    aliases: ['export jobs', 'general ledger exports'],
    requiredPermissions: ['reports:view'],
    placements: ['search'],
  },
  {
    key: 'notifications',
    label: 'Notifications',
    href: '/notifications',
    section: 'top-level',
    icon: 'Dashboard',
    aliases: ['notification inbox'],
    requiredPermissions: [],
    placements: ['search'],
  },
  {
    key: 'profile',
    label: 'Profile',
    href: '/profile',
    section: 'top-level',
    icon: 'Dashboard',
    aliases: ['account profile'],
    requiredPermissions: [],
    placements: ['search'],
  },
  {
    key: 'personal-settings',
    label: 'Personal Settings',
    href: '/settings',
    section: 'top-level',
    icon: 'WorkspaceSettings',
    aliases: ['my settings', 'notification preferences'],
    requiredPermissions: [],
    placements: ['search'],
  },
];

export interface ProductNavigationSection {
  readonly key: ProductNavSectionKey;
  readonly label: string | null;
  readonly defaultOpen: boolean;
  readonly routes: readonly ProductRoute[];
}

export interface ProductSearchResult {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly resultType: 'Destination' | 'Action';
  readonly section: ProductNavSectionKey;
}

function hasGrantedPermission(
  requiredPermissions: readonly PermissionKey[],
  grantedPermissions: ReadonlySet<PermissionKey>,
): boolean {
  return (
    requiredPermissions.length === 0 ||
    requiredPermissions.some((permission) => grantedPermissions.has(permission))
  );
}

function normalizedSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function searchMatchRank(
  query: string,
  label: string,
  aliases: readonly string[],
): number | undefined {
  const terms = [label, ...aliases].map(normalizedSearchText);
  if (terms.some((term) => term === query)) return 0;
  if (terms.some((term) => term.startsWith(query) || query.startsWith(term))) return 1;
  if (terms.some((term) => term.includes(query) || query.includes(term))) return 2;
  return undefined;
}

function grantedPermissionSet(permissions: readonly PermissionKey[]): ReadonlySet<PermissionKey> {
  return new Set(permissions);
}

export function canAccessProductRoute(
  route: Pick<ProductRoute, 'requiredPermissions'>,
  permissions: readonly PermissionKey[],
): boolean {
  return hasGrantedPermission(route.requiredPermissions, grantedPermissionSet(permissions));
}

export function canAccessProductAction(
  action: Pick<ProductRouteAction, 'requiredPermissions'>,
  permissions: readonly PermissionKey[],
): boolean {
  return hasGrantedPermission(action.requiredPermissions, grantedPermissionSet(permissions));
}

export function canAccessProductActionForPathname(
  pathname: string,
  permissions: readonly PermissionKey[],
): boolean {
  const action = productActionForPathname(pathname);
  return action ? canAccessProductAction(action, permissions) : false;
}

export function visibleProductRoutes(
  permissions: readonly PermissionKey[],
): readonly ProductRoute[] {
  const grantedPermissions = grantedPermissionSet(permissions);
  return PRODUCT_ROUTES.filter((route) =>
    hasGrantedPermission(route.requiredPermissions, grantedPermissions),
  );
}

export function productNavigationSections(
  permissions: readonly PermissionKey[],
): readonly ProductNavigationSection[] {
  const visibleRoutes = visibleProductRoutes(permissions);
  return PRODUCT_NAV_SECTIONS.map((section) => ({
    ...section,
    routes: visibleRoutes.filter(
      (route) => route.section === section.key && route.placements.includes('primary'),
    ),
  })).filter((section) => section.routes.length > 0);
}

export function supplierHubRoutes(permissions: readonly PermissionKey[]): readonly ProductRoute[] {
  return visibleProductRoutes(permissions).filter((route) =>
    route.placements.includes('supplier-hub'),
  );
}

export function productSearchResults(
  query: string,
  permissions: readonly PermissionKey[],
): readonly ProductSearchResult[] {
  const normalizedQuery = normalizedSearchText(query);
  if (!normalizedQuery) return [];

  const grantedPermissions = grantedPermissionSet(permissions);
  const destinations = PRODUCT_ROUTES.flatMap((route) => {
    if (!route.placements.includes('search')) return [];
    if (!hasGrantedPermission(route.requiredPermissions, grantedPermissions)) return [];
    const rank = searchMatchRank(normalizedQuery, route.label, route.aliases);
    if (rank === undefined) return [];
    return [
      {
        key: `route:${route.key}`,
        label: route.label,
        href: route.href,
        resultType: 'Destination' as const,
        section: route.section,
        rank,
      },
    ];
  });

  const actions = PRODUCT_ROUTES.flatMap((route) =>
    route.placements.includes('search') &&
    hasGrantedPermission(route.requiredPermissions, grantedPermissions)
      ? (route.actions ?? []).flatMap((action) => {
          if (!hasGrantedPermission(action.requiredPermissions, grantedPermissions)) return [];
          const rank = searchMatchRank(normalizedQuery, action.label, action.aliases);
          if (rank === undefined) return [];
          return [
            {
              key: `action:${action.key}`,
              label: action.label,
              href: action.href,
              resultType: 'Action' as const,
              section: route.section,
              rank,
            },
          ];
        })
      : [],
  );

  return [...destinations, ...actions]
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        Number(right.resultType === 'Action') - Number(left.resultType === 'Action'),
    )
    .map(({ rank: _rank, ...result }) => result);
}

export function productActionForPathname(pathname: string): ProductRouteAction | undefined {
  return PRODUCT_ROUTES.flatMap((route) => route.actions ?? [])
    .filter(
      (action) =>
        action.href === pathname || (action.href !== '/' && pathname.startsWith(`${action.href}/`)),
    )
    .sort((left, right) => right.href.length - left.href.length)[0];
}

export function productRouteForPathname(pathname: string): ProductRoute | undefined {
  return PRODUCT_ROUTES.filter(
    (route) =>
      route.href === pathname || (route.href !== '/' && pathname.startsWith(`${route.href}/`)),
  ).sort((left, right) => right.href.length - left.href.length)[0];
}
