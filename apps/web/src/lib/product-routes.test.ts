import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILT_IN_ROLE_PERMISSIONS } from '@betterspend/shared';
import {
  PRODUCT_ROUTES,
  productNavigationSections,
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

test('specific product routes win when resolving a saved nested URL', () => {
  assert.equal(productRouteForPathname('/vendors/onboarding')?.key, 'supplier-onboarding');
  assert.equal(productRouteForPathname('/purchase-orders/new')?.key, 'purchase-orders');
});
