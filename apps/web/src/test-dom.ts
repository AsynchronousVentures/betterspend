import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
const { window } = dom;

Object.defineProperties(globalThis, {
  window: { configurable: true, value: window },
  document: { configurable: true, value: window.document },
  navigator: { configurable: true, value: window.navigator },
  HTMLElement: { configurable: true, value: window.HTMLElement },
  HTMLInputElement: { configurable: true, value: window.HTMLInputElement },
  HTMLButtonElement: { configurable: true, value: window.HTMLButtonElement },
  HTMLAnchorElement: { configurable: true, value: window.HTMLAnchorElement },
  Element: { configurable: true, value: window.Element },
  Node: { configurable: true, value: window.Node },
  NodeFilter: { configurable: true, value: window.NodeFilter },
  Text: { configurable: true, value: window.Text },
  Range: { configurable: true, value: window.Range },
  Event: { configurable: true, value: window.Event },
  CustomEvent: { configurable: true, value: window.CustomEvent },
  MouseEvent: { configurable: true, value: window.MouseEvent },
  KeyboardEvent: { configurable: true, value: window.KeyboardEvent },
  MutationObserver: { configurable: true, value: window.MutationObserver },
  DOMRect: { configurable: true, value: window.DOMRect },
  getComputedStyle: { configurable: true, value: window.getComputedStyle.bind(window) },
  requestAnimationFrame: {
    configurable: true,
    value: window.requestAnimationFrame.bind(window),
  },
  cancelAnimationFrame: {
    configurable: true,
    value: window.cancelAnimationFrame.bind(window),
  },
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
