import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  commitmentDeltas,
  committedPurchaseOrderBalance,
  invoiceCommitmentAmounts,
  reducedPurchaseOrderBalance,
  releasedPurchaseOrderBalance,
  type CommitmentBalance,
} from './budget-commitments';

const empty: CommitmentBalance = { reserved: '0.00', committed: '0.00', expended: '0.00' };
const emptyPurchaseOrder = { ...empty, invoiced: '0.00' };

describe('budget commitment stages', () => {
  it('reserves an approved requisition', () => {
    assert.deepEqual(
      commitmentDeltas(empty, { reserved: '125.00', committed: '0.00', expended: '0.00' }),
      { reserved: '125.00', committed: '0.00', expended: '0.00' },
    );
  });

  it('converts a reservation into a PO commitment', () => {
    assert.deepEqual(
      commitmentDeltas(
        { reserved: '125.00', committed: '0.00', expended: '0.00' },
        { reserved: '0.00', committed: '120.00', expended: '0.00' },
      ),
      { reserved: '-125.00', committed: '120.00', expended: '0.00' },
    );
  });

  it('moves only the approved invoice amount from committed to expended', () => {
    assert.deepEqual(
      commitmentDeltas(
        { reserved: '0.00', committed: '120.00', expended: '0.00' },
        { reserved: '0.00', committed: '70.00', expended: '50.00' },
      ),
      { reserved: '0.00', committed: '-50.00', expended: '50.00' },
    );
  });

  it('records a release as a negative delta without erasing prior events', () => {
    assert.deepEqual(
      commitmentDeltas(
        { reserved: '0.00', committed: '70.00', expended: '50.00' },
        { reserved: '0.00', committed: '0.00', expended: '50.00' },
      ),
      { reserved: '0.00', committed: '-70.00', expended: '0.00' },
    );
  });

  it('releases a requisition reservation without erasing live PO commitments', () => {
    assert.deepEqual(
      commitmentDeltas(
        { reserved: '20.00', committed: '100.00', expended: '30.00' },
        { reserved: '0.00', committed: '100.00', expended: '30.00' },
      ),
      { reserved: '-20.00', committed: '0.00', expended: '0.00' },
    );
  });
});

describe('invoice commitment amounts', () => {
  it('expenses net recoverable tax and releases the gross PO commitment', () => {
    assert.deepEqual(invoiceCommitmentAmounts('125.00', '25.00'), {
      expense: '100.00',
      commitmentRelease: '125.00',
    });
  });
});

describe('purchase order commitment arithmetic', () => {
  it('preserves a sibling PO while consuming the remaining requisition reservation', () => {
    assert.deepEqual(
      committedPurchaseOrderBalance(
        { reserved: '100.00', committed: '100.00', expended: '0.00' },
        emptyPurchaseOrder,
        '80.00',
      ),
      { reserved: '20.00', committed: '180.00', expended: '0.00' },
    );
  });

  it('releases only an outstanding partially invoiced PO and preserves spend', () => {
    assert.deepEqual(
      releasedPurchaseOrderBalance(
        { reserved: '0.00', committed: '170.00', expended: '30.00' },
        { reserved: '0.00', committed: '70.00', expended: '25.00', invoiced: '30.00' },
        '100.00',
      ),
      { reserved: '0.00', committed: '100.00', expended: '30.00' },
    );
  });

  it('does not create a negative commitment when a PO is reduced below spend', () => {
    assert.deepEqual(
      reducedPurchaseOrderBalance(
        { reserved: '0.00', committed: '70.00', expended: '30.00' },
        { reserved: '0.00', committed: '70.00', expended: '25.00', invoiced: '30.00' },
        '20.00',
      ),
      { reserved: '0.00', committed: '0.00', expended: '30.00' },
    );
  });

  it('uses gross invoiced value when recoverable tax makes spend lower', () => {
    assert.deepEqual(
      reducedPurchaseOrderBalance(
        { reserved: '0.00', committed: '65.00', expended: '50.00' },
        { reserved: '0.00', committed: '65.00', expended: '50.00', invoiced: '60.00' },
        '100.00',
      ),
      { reserved: '0.00', committed: '40.00', expended: '50.00' },
    );
  });
});
