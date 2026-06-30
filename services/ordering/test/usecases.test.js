import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemClock } from '#core';
import { EVENTS } from '#contracts';
import { InMemoryOutbox, InMemoryEventBus } from '#events';
import { InMemoryOrderRepository, InMemorySessionRepository } from '../src/adapters/repos.js';
import { makeUseCases } from '../src/application/usecases.js';

function setup() {
  const orders = new InMemoryOrderRepository();
  const sessions = new InMemorySessionRepository();
  const outbox = new InMemoryOutbox();
  const bus = new InMemoryEventBus();
  const uc = makeUseCases({ orders, sessions, outbox, clock: systemClock });
  return { uc, orders, sessions, outbox, bus };
}
const tenantA = { tenantId: 'acme', tier: 'T1_POOLED', region: 'ap-mumbai-1' };
const tenantB = { tenantId: 'globex', tier: 'T1_POOLED', region: 'ap-mumbai-1' };

test('placeOrder persists and stages an OrderPlaced event', async () => {
  const { uc, outbox } = setup();
  const r = await uc.placeOrder(tenantA, { tableId: 'T12', items: [{ menuItemId: 'paneer', unitPriceMinor: 24000, qty: 1 }] });
  assert.ok(r.ok);
  assert.equal(r.value.order.status, 'PENDING');
  assert.equal(r.value.totals.total.minor, 25200); // 24000 + 5%
  assert.equal(outbox.size(), 1);
  assert.equal(outbox.peek()[0].type, EVENTS.OrderPlaced);
});

test('placeOrder rejects invalid input with a validation error', async () => {
  const { uc } = setup();
  const r = await uc.placeOrder(tenantA, { tableId: '', items: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'VALIDATION');
  assert.ok(Array.isArray(r.error.details));
});

test('tenant isolation: tenant B cannot read tenant A orders', async () => {
  const { uc } = setup();
  const placed = await uc.placeOrder(tenantA, { tableId: 'T1', items: [{ menuItemId: 'x', unitPriceMinor: 1000, qty: 1 }] });
  const id = placed.value.order.id;
  const a = await uc.getOrder(tenantA, id);
  const b = await uc.getOrder(tenantB, id);
  assert.ok(a.ok);
  assert.equal(b.ok, false);
  assert.equal(b.error.code, 'NOT_FOUND');
});

test('outbox relays staged events to subscribers exactly once', async () => {
  const { uc, outbox, bus } = setup();
  const seen = [];
  bus.subscribe(EVENTS.OrderPlaced, (e) => seen.push(e));
  await uc.placeOrder(tenantA, { tableId: 'T1', items: [{ menuItemId: 'x', unitPriceMinor: 1000, qty: 1 }] });
  const n = await outbox.relayTo(bus);
  assert.equal(n, 1);
  assert.equal(seen.length, 1);
  assert.equal(await outbox.relayTo(bus), 0); // drained
});

test('shared-table flow: open, add items, split', async () => {
  const { uc } = setup();
  const s = await uc.openSession(tenantA, { tableId: 'T12', participants: [{ id: 'Y' }, { id: 'R' }] });
  await uc.addSharedItem(tenantA, s.value.id, { participantId: 'Y', name: 'Paneer', priceMinor: 24000 });
  await uc.addSharedItem(tenantA, s.value.id, { name: 'Platter', priceMinor: 46000, shared: true });
  const split = await uc.getSplit(tenantA, s.value.id, 'by_item');
  assert.ok(split.ok);
  assert.equal(split.value.split.Y.minor, 49350);
  assert.equal(split.value.split.R.minor, 24150);
});
