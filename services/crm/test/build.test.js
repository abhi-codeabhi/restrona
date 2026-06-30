import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCrmService } from '../src/build.js';

test('buildCrmService wires the CRM use cases', () => {
  const { useCases } = buildCrmService();
  for (const m of ['upsertGuest', 'recordVisit', 'setPreferences', 'getChit']) {
    assert.equal(typeof useCases[m], 'function', `${m} should be a function`);
  }
});
