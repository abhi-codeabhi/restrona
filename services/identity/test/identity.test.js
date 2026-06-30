import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryOutbox } from '#events';
import { InMemoryUserRepository } from '../src/adapters/repos.js';
import { makeIdentityUseCases } from '../src/application/usecases.js';
import { can, isValidRole } from '../src/domain/rbac.js';
import { canManage } from '../src/domain/hierarchy.js';

const T = { tenantId: 'acme', tier: 'T1_POOLED', region: 'ap-mumbai-1' };

function setup() {
  const users = new InMemoryUserRepository();
  const outbox = new InMemoryOutbox();
  const uc = makeIdentityUseCases({ users, outbox });
  return { uc, users, outbox };
}

/* ---------- RBAC: can(subject, action, resource) ---------- */

test('owner can staff:manage', () => {
  assert.equal(can({ role: 'owner', restaurantIds: [] }, 'staff:manage', {}), true);
});

test('waiter cannot staff:manage', () => {
  assert.equal(can({ role: 'waiter', restaurantIds: ['r1'] }, 'staff:manage', {}), false);
});

test('owner wildcard order:* allows order:create', () => {
  assert.equal(can({ role: 'owner', restaurantIds: [] }, 'order:create', {}), true);
});

/* ---------- ABAC: restaurant scoping ---------- */

test('waiter with restaurantIds [r1] can act on r1 but NOT r2', () => {
  const waiter = { role: 'waiter', restaurantIds: ['r1'] };
  assert.equal(can(waiter, 'order:create', { restaurantId: 'r1' }), true);
  assert.equal(can(waiter, 'order:create', { restaurantId: 'r2' }), false);
});

test('owner spans all restaurants (ABAC bypass)', () => {
  const owner = { role: 'owner', restaurantIds: [] };
  assert.equal(can(owner, 'order:create', { restaurantId: 'r9' }), true);
});

test('platform * allows anything, any restaurant', () => {
  const platform = { role: 'platform', restaurantIds: [] };
  assert.equal(can(platform, 'staff:manage', {}), true);
  assert.equal(can(platform, 'literally:anything', { restaurantId: 'rX' }), true);
});

/* ---------- Hierarchy: canManage ---------- */

test('canManage: owner manages manager (true), waiter manages manager (false)', () => {
  assert.equal(canManage('owner', 'manager'), true);
  assert.equal(canManage('waiter', 'manager'), false);
});

test('canManage: manager manages staff but not owner', () => {
  assert.equal(canManage('manager', 'waiter'), true);
  assert.equal(canManage('manager', 'owner'), false);
});

/* ---------- Use cases ---------- */

test('assignRole validates role and persists user, stages event', async () => {
  const { uc, users, outbox } = setup();
  const r = await uc.assignRole(T, { userId: 'u1', role: 'waiter', restaurantIds: ['r1'] });
  assert.ok(r.ok);
  assert.equal(r.value.role, 'waiter');
  assert.deepEqual(r.value.restaurantIds, ['r1']);
  assert.equal(outbox.size(), 1);
  const stored = await users.findById(T, 'u1');
  assert.equal(stored.role, 'waiter');
});

test('assignRole rejects an unknown role', async () => {
  const { uc } = setup();
  const r = await uc.assignRole(T, { userId: 'u2', role: 'superadmin' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal(isValidRole('superadmin'), false);
});

test('check use case returns { allowed }', async () => {
  const { uc } = setup();
  const yes = await uc.check(T, { subject: { role: 'owner', restaurantIds: [] }, action: 'staff:manage', resource: {} });
  assert.ok(yes.ok);
  assert.deepEqual(yes.value, { allowed: true });

  const no = await uc.check(T, { subject: { role: 'waiter', restaurantIds: ['r1'] }, action: 'order:create', resource: { restaurantId: 'r2' } });
  assert.deepEqual(no.value, { allowed: false });
});
