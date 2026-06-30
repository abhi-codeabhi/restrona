import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemClock } from '#core';
import { InMemoryOutbox, InMemoryEventBus } from '#events';
import { InMemoryTenantDirectory } from '../src/adapters/repos.js';
import { makeTenantUseCases } from '../src/application/usecases.js';
import { EVENTS } from '../src/application/events.js';
import { planFee, outletFee } from '../src/domain/tenant.js';

function setup() {
  const directory = new InMemoryTenantDirectory();
  const outbox = new InMemoryOutbox();
  const bus = new InMemoryEventBus();
  const uc = makeTenantUseCases({ directory, outbox, clock: systemClock });
  return { uc, directory, outbox, bus };
}

test('provisionTenant creates an active tenant, returns tier, and stages provisioned + metered events', async () => {
  const { uc, outbox } = setup();
  const r = await uc.provisionTenant({ owner: 'Yash', email: 'yash@acme.in', plan: 'Growth', region: 'ap-mumbai-1' });
  assert.ok(r.ok);
  assert.equal(r.value.tenant.status, 'active');
  assert.equal(r.value.tier, 'T1_POOLED');
  assert.equal(r.value.tenant.restaurants.length, 0);

  const types = outbox.peek().map((e) => e.type);
  assert.ok(types.includes(EVENTS.TenantProvisioned));
  assert.ok(types.includes(EVENTS.UsageMetered));
  const metered = outbox.peek().find((e) => e.type === EVENTS.UsageMetered);
  assert.equal(metered.payload.billable, true);
  assert.equal(metered.payload.amountMinor, planFee.Growth); // 9999
});

test('Scale plan derives T2_SCHEMA tier', async () => {
  const { uc } = setup();
  const r = await uc.provisionTenant({ owner: 'R', email: 'r@scale.in', plan: 'Scale' });
  assert.ok(r.ok);
  assert.equal(r.value.tier, 'T2_SCHEMA');
});

test('provisionTenant rejects invalid input with a validation error', async () => {
  const { uc } = setup();
  const r = await uc.provisionTenant({ owner: '', email: 'nope', plan: 'Bogus' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'VALIDATION');
  assert.ok(Array.isArray(r.error.details));
});

test('addRestaurant increments restaurants and stages a metered event with the outlet fee', async () => {
  const { uc, outbox } = setup();
  const p = await uc.provisionTenant({ owner: 'Y', email: 'y@acme.in', plan: 'Starter' });
  const tenantId = p.value.tenant.id;
  const before = outbox.size();

  const r = await uc.addRestaurant(tenantId, { name: 'Acme Andheri', brand: 'Acme', city: 'Mumbai' });
  assert.ok(r.ok);
  assert.equal(r.value.tenant.restaurants.length, 1);
  assert.equal(r.value.restaurant.status, 'onboarding');

  assert.equal(outbox.size(), before + 1);
  const last = outbox.peek().at(-1);
  assert.equal(last.type, EVENTS.UsageMetered);
  assert.equal(last.payload.sku, 'outlet');
  assert.equal(last.payload.billable, true);
  assert.equal(last.payload.amountMinor, outletFee.Starter); // 2999
});

test('addRestaurant on a missing tenant returns NOT_FOUND', async () => {
  const { uc } = setup();
  const r = await uc.addRestaurant('ten_missing', { name: 'X' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NOT_FOUND');
});

test('listTenants returns provisioned tenants', async () => {
  const { uc } = setup();
  await uc.provisionTenant({ owner: 'A', email: 'a@a.in', plan: 'Starter' });
  await uc.provisionTenant({ owner: 'B', email: 'b@b.in', plan: 'Scale' });
  const r = await uc.listTenants();
  assert.ok(r.ok);
  assert.equal(r.value.length, 2);
  assert.ok(r.value.every((t) => t.status === 'active'));
});

test('outbox relays staged tenant events to subscribers exactly once', async () => {
  const { uc, outbox, bus } = setup();
  const seen = [];
  bus.subscribe(EVENTS.TenantProvisioned, (e) => seen.push(e));
  await uc.provisionTenant({ owner: 'A', email: 'a@a.in', plan: 'Growth' });
  const n = await outbox.relayTo(bus);
  assert.ok(n >= 2);
  assert.equal(seen.length, 1);
  assert.equal(await outbox.relayTo(bus), 0);
});
