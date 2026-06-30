import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingService } from '../src/build.js';

test('buildBillingService wires the billing use cases', () => {
  const { useCases } = buildBillingService();
  for (const m of ['openBill', 'getBill', 'applyDiscount', 'splitBill', 'recordPayment', 'reconcile']) {
    assert.equal(typeof useCases[m], 'function', `${m} should be a function`);
  }
});
