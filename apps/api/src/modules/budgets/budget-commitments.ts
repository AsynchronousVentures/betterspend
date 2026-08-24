import { addMoney, subtractMoneyFloorZero } from './budget-enforcement';

export interface InvoiceCommitmentAmounts {
  expense: string;
  commitmentRelease: string;
}

export interface CommitmentBalance {
  reserved: string;
  committed: string;
  expended: string;
}

export interface PurchaseOrderCommitmentBalance extends CommitmentBalance {
  /** Gross invoice amount already converted out of this PO's commitment. */
  invoiced: string;
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

/** Keep recoverable tax out of spend while releasing the invoice's gross PO commitment. */
export function invoiceCommitmentAmounts(
  invoiceTotal: string,
  recoverableTax: string,
): InvoiceCommitmentAmounts {
  return {
    expense: addMoney([invoiceTotal, `-${recoverableTax}`]),
    commitmentRelease: invoiceTotal,
  };
}

/** Add only this PO's outstanding amount to its requisition-wide staged balance. */
export function committedPurchaseOrderBalance(
  current: CommitmentBalance,
  currentPurchaseOrder: PurchaseOrderCommitmentBalance,
  purchaseOrderTotal: string,
): CommitmentBalance {
  const desiredPurchaseOrderCommitment = subtractMoneyFloorZero(
    purchaseOrderTotal,
    currentPurchaseOrder.invoiced,
  );
  const commitmentDelta = addMoney([
    desiredPurchaseOrderCommitment,
    `-${currentPurchaseOrder.committed}`,
  ]);
  const newReservationUsed = subtractMoneyFloorZero(
    desiredPurchaseOrderCommitment,
    currentPurchaseOrder.committed,
  );
  return {
    reserved: subtractMoneyFloorZero(current.reserved, newReservationUsed),
    committed: addMoney([current.committed, commitmentDelta]),
    expended: current.expended,
  };
}

/** A reduction cannot recreate commitment or reduce it below already-expended spend. */
export function reducedPurchaseOrderBalance(
  current: CommitmentBalance,
  currentPurchaseOrder: PurchaseOrderCommitmentBalance,
  purchaseOrderTotal: string,
): CommitmentBalance {
  const outstandingAfterChange = subtractMoneyFloorZero(
    purchaseOrderTotal,
    currentPurchaseOrder.invoiced,
  );
  const reducedPurchaseOrderCommitment = subtractMoneyFloorZero(
    currentPurchaseOrder.committed,
    subtractMoneyFloorZero(currentPurchaseOrder.committed, outstandingAfterChange),
  );
  const commitmentReduction = subtractMoneyFloorZero(
    currentPurchaseOrder.committed,
    reducedPurchaseOrderCommitment,
  );
  return {
    ...current,
    committed: subtractMoneyFloorZero(current.committed, commitmentReduction),
  };
}

/** Remove only the cancelled PO's outstanding share while preserving recorded spend. */
export function releasedPurchaseOrderBalance(
  current: CommitmentBalance,
  currentPurchaseOrder: PurchaseOrderCommitmentBalance,
  purchaseOrderTotal: string,
): CommitmentBalance {
  const plannedOutstanding = subtractMoneyFloorZero(
    purchaseOrderTotal,
    currentPurchaseOrder.invoiced,
  );
  const reservationRelease = subtractMoneyFloorZero(
    current.reserved,
    subtractMoneyFloorZero(current.reserved, plannedOutstanding),
  );
  return {
    reserved: subtractMoneyFloorZero(current.reserved, reservationRelease),
    committed: subtractMoneyFloorZero(current.committed, currentPurchaseOrder.committed),
    expended: current.expended,
  };
}
