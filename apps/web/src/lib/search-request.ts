export interface SearchRequestController {
  begin(): number;
  invalidate(): void;
  isCurrent(requestId: number): boolean;
}

export function createSearchRequestController(): SearchRequestController {
  let currentRequestId = 0;

  return {
    begin() {
      currentRequestId += 1;
      return currentRequestId;
    },
    invalidate() {
      currentRequestId += 1;
    },
    isCurrent(requestId) {
      return requestId === currentRequestId;
    },
  };
}
