import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceRequestsService } from '../src/build.js';

test('buildServiceRequestsService wires the service-request use cases', () => {
  const { useCases } = buildServiceRequestsService();
  for (const m of ['raise', 'escalateDue', 'acknowledge', 'listOpen']) {
    assert.equal(typeof useCases[m], 'function', `${m} should be a function`);
  }
});
