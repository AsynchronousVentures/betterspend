import assert from 'node:assert/strict';
import test from 'node:test';
import { multiplyMoney, normalizeMoney, sumMoney } from './money';

test('keeps monetary multiplication in decimal units', () => {
  assert.equal(multiplyMoney(3, '0.29'), '0.87');
  assert.equal(multiplyMoney('1.005', '1'), '1.01');
  assert.equal(sumMoney(['0.87', '0.13']), '1.00');
});

test('normalizes money to cents and rejects malformed values', () => {
  assert.equal(normalizeMoney('0004.2'), '4.20');
  assert.equal(normalizeMoney(2.675), '2.68');
  assert.throws(() => normalizeMoney('0.2e1'), /Invalid non-negative decimal/);
});
