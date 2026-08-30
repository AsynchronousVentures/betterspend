import type {
  InvoiceReviewCaseState,
  InvoiceReviewSignalSeverity,
  InvoiceReviewSignalStatus,
} from '@betterspend/shared';

export interface ReviewSignalState {
  severity: InvoiceReviewSignalSeverity;
  status: InvoiceReviewSignalStatus;
}

export function isOpenBlockingSignal(signal: ReviewSignalState): boolean {
  return signal.status === 'open' && signal.severity === 'blocking';
}

export function isOpenReviewSignal(signal: ReviewSignalState): boolean {
  return signal.status === 'open' && signal.severity !== 'informational';
}

export function initialReviewCaseState(signal: ReviewSignalState): InvoiceReviewCaseState {
  return isOpenReviewSignal(signal) ? 'open' : 'resolved';
}

/**
 * Keep command-owned states intact. Producers may open a new case or close an
 * unclaimed case, while only a new blocking signal reopens a resolved case.
 */
export function nextReviewCaseState(
  current: InvoiceReviewCaseState,
  signals: readonly ReviewSignalState[],
): InvoiceReviewCaseState {
  if (current === 'resolved' && signals.some(isOpenReviewSignal)) return 'open';
  if (current === 'open' && !signals.some(isOpenReviewSignal)) return 'resolved';
  return current;
}
