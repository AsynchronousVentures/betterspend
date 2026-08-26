import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCurrencyMinorUnits, sumCurrencyAmounts } from './money';

test('sums decimal amounts without binary floating-point loss', () => {
  const total = sumCurrencyAmounts(['0.1', '0.2', '0.01'], 'USD');

  assert.equal(total, '31');
  assert.equal(formatCurrencyMinorUnits(total, 'USD'), '$0.31');
});

test('rounds decimal values half away from zero for the display currency', () => {
  const total = sumCurrencyAmounts(['1.005'], 'USD');

  assert.equal(total, '101');
  assert.equal(formatCurrencyMinorUnits(total, 'USD'), '$1.01');
});
