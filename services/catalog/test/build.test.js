import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogService } from '../src/build.js';

test('buildCatalogService wires the catalog use cases', () => {
  const { useCases } = buildCatalogService();
  for (const m of ['addItem', 'toggleAvailability', 'getMenu', 'evaluateMenu', 'publishMenu']) {
    assert.equal(typeof useCases[m], 'function', `${m} should be a function`);
  }
});
