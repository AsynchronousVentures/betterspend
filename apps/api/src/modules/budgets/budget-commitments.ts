import { addMoney } from './budget-enforcement';

export interface CommitmentBalance {
  reserved: string;
  committed: string;
  expended: string;
}

/** Plan one append-only ledger event that moves the staged balance to the desired state. */
export function commitmentDeltas(
  current: CommitmentBalance,
  desired: CommitmentBalance,
): CommitmentBalance {
  return {
    reserved: addMoney([desired.reserved, `-${current.reserved}`]),
    committed: addMoney([desired.committed, `-${current.committed}`]),
    expended: addMoney([desired.expended, `-${current.expended}`]),
  };
}
