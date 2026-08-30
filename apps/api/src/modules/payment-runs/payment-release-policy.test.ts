import assert from 'node:assert/strict';
import test from 'node:test';
import {
  paymentReleaseBlockReason,
  type PaymentReleaseAccountSnapshot,
  type PaymentReleaseInvoiceSnapshot,
} from './payment-release-policy';

const approvedAt = new Date('2026-08-01T00:00:00.000Z');
const oldAccount: PaymentReleaseAccountSnapshot = {
  verificationStatus: 'verified',
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-15T00:00:00.000Z'),
};
const approvedInvoice: PaymentReleaseInvoiceSnapshot = {
  status: 'approved',
  approvedAt,
  vendorName: 'Acme Supplies',
  vendorStatus: 'active',
  onboardingStatus: 'approved',
  sanctionsStatus: 'clear',
};

test('allows an approved invoice with compliant vendor and unchanged verified account', () => {
  assert.equal(paymentReleaseBlockReason(approvedInvoice, [oldAccount]), null);
});

test('preserves active-vendor onboarding and sanctions semantics', () => {
  assert.equal(
    paymentReleaseBlockReason(
      { ...approvedInvoice, onboardingStatus: 'not_started', sanctionsStatus: 'untested' },
      [oldAccount],
    ),
    null,
  );
});

test('blocks an invoice until the release state and every compliance gate are valid', () => {
  assert.match(
    paymentReleaseBlockReason({ ...approvedInvoice, status: 'matched' }, [oldAccount]) ?? '',
    /Only approved invoices/,
  );
  assert.match(
    paymentReleaseBlockReason({ ...approvedInvoice, vendorStatus: 'blocked' }, [oldAccount]) ?? '',
    /not active/,
  );
  assert.match(
    paymentReleaseBlockReason({ ...approvedInvoice, onboardingStatus: 'changes_requested' }, [
      oldAccount,
    ]) ?? '',
    /onboarding/,
  );
  assert.match(
    paymentReleaseBlockReason({ ...approvedInvoice, sanctionsStatus: 'flagged' }, [oldAccount]) ??
      '',
    /sanctions/,
  );
  assert.match(paymentReleaseBlockReason(approvedInvoice, [] as const) ?? '', /verified payment/);
});

test('blocks a verified account created or changed after invoice approval', () => {
  const changedAccount = {
    ...oldAccount,
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  };

  assert.match(
    paymentReleaseBlockReason(approvedInvoice, [changedAccount]) ?? '',
    /changed after invoice approval/,
  );
  assert.match(
    paymentReleaseBlockReason(approvedInvoice, [
      { ...oldAccount, createdAt: new Date('2026-08-02T00:00:00.000Z') },
    ]) ?? '',
    /changed after invoice approval/,
  );
});

test('reuses compliance gates after release before a payment run submits', () => {
  assert.equal(
    paymentReleaseBlockReason(
      { ...approvedInvoice, status: 'ready_for_release' },
      [oldAccount],
      'ready_for_release',
    ),
    null,
  );
});
