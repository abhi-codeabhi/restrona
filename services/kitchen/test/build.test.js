import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKitchenService } from '../src/build.js';

test('buildKitchenService wires the kitchen use cases', () => {
  const { useCases } = buildKitchenService();
  for (const m of ['receiveTicket', 'advanceItem', 'markAllReady', 'getBoard', 'allDay']) {
    assert.equal(typeof useCases[m], 'function', `${m} should be a function`);
  }
});
