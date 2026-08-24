import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commitmentDeltas, type CommitmentBalance } from './budget-commitments';

const empty: CommitmentBalance = { reserved: '0.00', committed: '0.00', expended: '0.00' };

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
});
