import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantService } from '../src/build.js';

test('buildTenantService wires the tenant use cases', () => {
  const { useCases } = buildTenantService();
  for (const m of ['provisionTenant', 'addRestaurant', 'listTenants', 'getTenant']) {
    assert.equal(typeof useCases[m], 'function', `${m} should be a function`);
  }
});
