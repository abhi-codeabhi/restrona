import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentityService } from '../src/build.js';

test('buildIdentityService wires the identity use cases', () => {
  const { useCases } = buildIdentityService();
  for (const m of ['assignRole', 'check', 'canManageRole', 'getUser', 'listUsers']) {
    assert.equal(typeof useCases[m], 'function', `${m} should be a function`);
  }
});
