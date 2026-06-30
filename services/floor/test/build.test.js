import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFloorService } from '../src/build.js';

test('buildFloorService wires the floor use cases', () => {
  const { useCases } = buildFloorService();
  for (const m of ['initFloor', 'seatTable', 'assignWaiter', 'moveTable', 'getFloor']) {
    assert.equal(typeof useCases[m], 'function', `${m} should be a function`);
  }
});
