import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILT_IN_ROLE_PERMISSIONS } from '@betterspend/shared';
import {
  PRODUCT_ROUTES,
  canAccessProductAction,
  canAccessProductActionForPathname,
  canAccessProductRoute,
  productNavigationSections,
  productActionForPathname,
  productRouteForPathname,
  productSearchResults,
  visibleProductRoutes,
} from './product-routes';

function primaryRouteKeys(role: keyof typeof BUILT_IN_ROLE_PERMISSIONS): string[] {
  return productNavigationSections(BUILT_IN_ROLE_PERMISSIONS[role]).flatMap((section) =>
    section.routes.map((route) => route.key),
  );
}

test('built-in roles only see their permitted primary product routes', () => {
  const requester = primaryRouteKeys('requester');
  assert.deepEqual(requester, [
    'dashboard',
    'start-request',
    'requisitions',
    'purchase-orders',
    'catalog',
    'suppliers',
  ]);
  assert.equal(requester.includes('payment-runs'), false);
  assert.equal(requester.includes('users'), false);
  assert.equal(requester.includes('workspace-settings'), false);

  const receiver = primaryRouteKeys('receiver');
  assert.equal(receiver.includes('receiving'), true);
  assert.equal(receiver.includes('inventory'), true);
  assert.equal(receiver.includes('payment-runs'), false);
  assert.equal(receiver.includes('users'), false);

  const approver = primaryRouteKeys('approver');
  assert.equal(approver.includes('pending-approvals'), true);
  assert.equal(approver.includes('payment-runs'), false);
  assert.equal(approver.includes('workspace-settings'), false);

  const finance = primaryRouteKeys('finance');
  assert.equal(finance.includes('payment-runs'), true);
  assert.equal(finance.includes('users'), false);
  assert.equal(finance.includes('workspace-settings'), false);

  const admin = primaryRouteKeys('admin');
  const allPrimary = PRODUCT_ROUTES.filter((route) => route.placements.includes('primary')).map(
    (route) => route.key,
  );
  assert.deepEqual(admin, allPrimary);
});

test('multiple roles combine their permitted destinations without duplicates', () => {
  const permissions = [
    ...BUILT_IN_ROLE_PERMISSIONS.requester,
    ...BUILT_IN_ROLE_PERMISSIONS.receiver,
  ];
  const routes = visibleProductRoutes(permissions);
  const keys = routes.map((route) => route.key);

  assert.equal(keys.includes('requisitions'), true);
  assert.equal(keys.includes('receiving'), true);
  assert.equal(new Set(keys).size, keys.length);
});

test('product search only returns permitted destinations and common actions', () => {
  const financeResults = productSearchResults('Payment Runs', BUILT_IN_ROLE_PERMISSIONS.finance);
  assert.deepEqual(financeResults[0], {
    key: 'route:payment-runs',
    label: 'Payment Runs',
    href: '/payment-runs',
    resultType: 'Destination',
    section: 'finance',
  });
  assert.equal(
    productSearchResults('pay bills', BUILT_IN_ROLE_PERMISSIONS.finance).some(
      (result) => result.key === 'action:pay-bills',
    ),
    true,
  );
  assert.equal(
    productSearchResults('receive PO', BUILT_IN_ROLE_PERMISSIONS.receiver).some(
      (result) => result.key === 'action:receive-purchase-order',
    ),
    true,
  );
  assert.equal(
    productSearchResults('supplier risk', BUILT_IN_ROLE_PERMISSIONS.finance).some(
      (result) => result.key === 'route:supplier-risk',
    ),
    true,
  );
  assert.equal(
    productSearchResults('email invoices', BUILT_IN_ROLE_PERMISSIONS.finance).some(
      (result) => result.key === 'action:email-invoices',
    ),
    true,
  );
  assert.equal(productSearchResults('Payment Runs', BUILT_IN_ROLE_PERMISSIONS.requester).length, 0);
});

test('AP aging uses the permissions required by its backing invoice APIs', () => {
  const apAging = PRODUCT_ROUTES.find((route) => route.key === 'ap-aging');
  assert.ok(apAging);

  assert.equal(canAccessProductRoute(apAging, ['invoices:view_all']), true);
  assert.equal(canAccessProductRoute(apAging, ['payments:view']), true);
  assert.equal(canAccessProductRoute(apAging, ['reports:view']), false);
  assert.equal(
    productSearchResults('AP Aging', ['reports:view']).some(
      (result) => result.key === 'route:ap-aging',
    ),
    false,
  );
});

test('AP exception queue is discoverable only with invoice review visibility', () => {
  const route = PRODUCT_ROUTES.find((candidate) => candidate.key === 'invoice-reviews');
  assert.ok(route);
  assert.equal(route.href, '/invoice-reviews');
  assert.equal(canAccessProductRoute(route, ['invoices:view_all']), true);
  assert.equal(canAccessProductRoute(route, ['invoices:manage']), false);
  assert.equal(
    productSearchResults('AP exceptions', ['invoices:view_all'])[0]?.key,
    'route:invoice-reviews',
  );
});

test('exact action aliases rank ahead of matching destinations', () => {
  assert.equal(
    productSearchResults('receive PO', BUILT_IN_ROLE_PERMISSIONS.receiver)[0]?.key,
    'action:receive-purchase-order',
  );
  assert.equal(
    productSearchResults('pay bills', BUILT_IN_ROLE_PERMISSIONS.finance)[0]?.key,
    'action:pay-bills',
  );
  assert.equal(
    productSearchResults('email invoices', BUILT_IN_ROLE_PERMISSIONS.finance)[0]?.key,
    'action:email-invoices',
  );
});

test('specific product routes win when resolving a saved nested URL', () => {
  assert.equal(productRouteForPathname('/vendors/onboarding')?.key, 'supplier-onboarding');
  assert.equal(productRouteForPathname('/purchase-orders/new')?.key, 'purchase-orders');
  assert.equal(productActionForPathname('/purchase-orders/new')?.key, 'create-purchase-order');
});

test('direct route access uses the same capability metadata as navigation', () => {
  const paymentRuns = PRODUCT_ROUTES.find((route) => route.key === 'payment-runs');
  assert.ok(paymentRuns);
  const createPurchaseOrder = productActionForPathname('/purchase-orders/new');
  assert.ok(createPurchaseOrder);

  assert.equal(canAccessProductRoute(paymentRuns, BUILT_IN_ROLE_PERMISSIONS.finance), true);
  assert.equal(canAccessProductRoute(paymentRuns, BUILT_IN_ROLE_PERMISSIONS.requester), false);
  assert.equal(canAccessProductAction(createPurchaseOrder, ['purchase_orders:create']), true);
  assert.equal(
    canAccessProductAction(createPurchaseOrder, BUILT_IN_ROLE_PERMISSIONS.requester),
    false,
  );
});

test('payment-run mutation controls use the action capability, not the read capability', () => {
  assert.equal(canAccessProductActionForPathname('/payment-runs', ['payments:view']), false);
  assert.equal(canAccessProductActionForPathname('/payment-runs', ['payments:manage']), true);
});

test('issue-only purchase-order access can read the destination', () => {
  const purchaseOrders = PRODUCT_ROUTES.find((route) => route.key === 'purchase-orders');
  assert.ok(purchaseOrders);
  assert.equal(canAccessProductRoute(purchaseOrders, ['purchase_orders:issue']), true);
});

test('direct create URLs require their action permission and a readable destination', () => {
  const cases = [
    ['/requisitions/new', 'requisitions:create', 'requisitions:view_own'],
    ['/purchase-orders/new', 'purchase_orders:create', 'purchase_orders:view_own'],
    ['/receiving/new', 'receiving:create', 'receiving:view'],
    ['/invoices/new', 'invoices:create', 'invoices:view_all'],
    ['/inventory/new', 'inventory:manage', 'inventory:view'],
    ['/budgets/new', 'budgets:manage', 'budgets:view'],
    ['/contracts/new', 'contracts:manage', 'contracts:view'],
    ['/vendors/new', 'vendors:create', 'vendors:view'],
  ] as const;

  for (const [pathname, actionPermission, readPermission] of cases) {
    const action = productActionForPathname(pathname);
    const route = productRouteForPathname(pathname);
    assert.ok(action, pathname);
    assert.ok(route, pathname);
    assert.equal(canAccessProductAction(action, [actionPermission]), true, pathname);
    assert.equal(canAccessProductRoute(route, [actionPermission]), false, pathname);
    assert.equal(canAccessProductRoute(route, [readPermission]), true, pathname);
  }
});

test('destination read permissions do not accept write-only grants', () => {
  const cases = [
    ['rfq', 'rfqs:manage'],
    ['catalog', 'catalog:manage'],
    ['inventory', 'inventory:manage'],
    ['tax-codes', 'settings:manage'],
    ['currencies', 'settings:manage'],
    ['suppliers', 'vendors:edit'],
    ['contracts', 'contracts:manage'],
    ['software-licenses', 'software_licenses:manage'],
    ['gl-integration', 'reports:export'],
  ] as const;

  for (const [key, writePermission] of cases) {
    const route = PRODUCT_ROUTES.find((candidate) => candidate.key === key);
    assert.ok(route, key);
    assert.equal(canAccessProductRoute(route, [writePermission]), false, key);
  }
});
