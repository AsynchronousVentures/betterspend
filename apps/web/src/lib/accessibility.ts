const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface FocusTarget {
  focus: () => void;
  isConnected?: boolean;
}

export function restoreFocus(target: FocusTarget | null): boolean {
  if (!target || target.isConnected === false) return false;
  target.focus();
  return true;
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getAttribute('aria-hidden') !== 'true',
  );
}

export function getFocusTrapIndex(
  itemCount: number,
  currentIndex: number,
  shiftKey: boolean,
): number | null {
  if (itemCount === 0) return null;
  if (currentIndex < 0) return shiftKey ? itemCount - 1 : 0;
  if (shiftKey && currentIndex <= 0) return itemCount - 1;
  if (!shiftKey && currentIndex === itemCount - 1) return 0;
  return null;
}

export function getSearchActiveIndex(
  currentIndex: number,
  optionCount: number,
  key: string,
): number | null {
  if (optionCount === 0) return null;
  if (key === 'ArrowDown') return currentIndex < 0 ? 0 : (currentIndex + 1) % optionCount;
  if (key === 'ArrowUp') return currentIndex <= 0 ? optionCount - 1 : currentIndex - 1;
  return null;
}

export function getSearchOptionId(index: number): string {
  return `global-search-option-${index}`;
}

export function getSearchSelectionIndex(
  activeIndex: number,
  optionCount: number,
  key: string,
): number | null {
  if (key !== 'Enter' || activeIndex < 0 || activeIndex >= optionCount) return null;
  return activeIndex;
}

export function createSearchRequestController() {
  let currentRequest = 0;

  return {
    begin() {
      currentRequest += 1;
      return currentRequest;
    },
    invalidate() {
      currentRequest += 1;
    },
    isCurrent(requestId: number) {
      return requestId === currentRequest;
    },
  };
}
