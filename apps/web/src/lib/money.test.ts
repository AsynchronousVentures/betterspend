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

test('rounds after aggregating amounts at a finer scale than the currency', () => {
  const total = sumCurrencyAmounts(['0.4', '0.4'], 'JPY');

  assert.equal(total, '1');
  assert.equal(formatCurrencyMinorUnits(total, 'JPY'), '¥1');
});

test('preserves signed invoice amounts in the total preview', () => {
  const total = sumCurrencyAmounts(['-10.00', '3.25'], 'USD');

  assert.equal(total, '-675');
  assert.equal(formatCurrencyMinorUnits(total, 'USD'), '-$6.75');
});
