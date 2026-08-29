import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it('formats decimal strings with the default locale and currency', () => {
    assert.equal(formatMoney('1234.5'), '$1,234.50');
  });

  it('honors the requested locale and currency', () => {
    assert.equal(formatMoney('1234.5', 'eur', 'de-DE'), '1.234,50 €');
  });

  it('renders zero and rejects missing or non-finite amounts', () => {
    assert.equal(formatMoney('0', 'USD'), '$0.00');
    assert.equal(formatMoney('', 'USD'), 'Not available');
    assert.equal(formatMoney('not-a-number', 'USD'), 'Not available');
    assert.equal(formatMoney(Number.POSITIVE_INFINITY, 'USD'), 'Not available');
  });

  it('uses safe defaults for malformed currency and locale values', () => {
    assert.equal(formatMoney('12.34', 'US', 'en-US'), '$12.34');
    assert.equal(formatMoney('12.34', 'USD', 'not a locale'), '12.34 USD');
  });
});
