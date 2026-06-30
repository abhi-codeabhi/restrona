import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPromotionsService } from '../src/build.js';

test('buildPromotionsService wires the promotions use cases', () => {
  const { useCases } = buildPromotionsService();
  for (const m of ['createCoupon', 'toggleCoupon', 'evaluate']) {
    assert.equal(typeof useCases[m], 'function', `${m} should be a function`);
  }
});
