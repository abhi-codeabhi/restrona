import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemClock } from '#core';
import { InMemoryOutbox, InMemoryEventBus } from '#events';
import { InMemoryTicketRepository } from '../src/adapters/repos.js';
import { makeKitchenUseCases, EVENTS } from '../src/application/usecases.js';
import { isAllReady, STATES } from '../src/domain/ticket.js';

function setup() {
  const tickets = new InMemoryTicketRepository();
  const outbox = new InMemoryOutbox();
  const bus = new InMemoryEventBus();
  const uc = makeKitchenUseCases({ tickets, outbox, clock: systemClock });
  return { uc, tickets, outbox, bus };
}

const T = { tenantId: 'acme', tier: 'T1_POOLED', region: 'ap-mumbai-1' };

const sampleItems = [
  { name: 'Paneer Tikka', station: 'tandoor' },
  { name: 'Grilled Chicken', station: 'grill' },
  { name: 'Garden Salad', station: 'cold' },
];

test('receiveTicket creates a NEW ticket and stages a fired event', async () => {
  const { uc, outbox } = setup();
  const r = await uc.receiveTicket(T, { orderId: 'ord_1', table: 'T12', items: sampleItems });
  assert.ok(r.ok);
  assert.equal(r.value.items.length, 3);
  assert.ok(r.value.items.every((it) => STATES[it.state] === 'new'));
  assert.equal(outbox.size(), 1);
  assert.equal(outbox.peek()[0].type, EVENTS.TicketFired);
});

test('receiveTicket rejects invalid input with a validation error', async () => {
  const { uc } = setup();
  const r = await uc.receiveTicket(T, { orderId: '', table: '', items: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'VALIDATION');
  assert.ok(Array.isArray(r.error.details));
});

test('advanceItem moves new -> preparing -> ready and stays at ready', async () => {
  const { uc } = setup();
  const created = await uc.receiveTicket(T, { orderId: 'ord_1', table: 'T1', items: sampleItems });
  const ticketId = created.value.id;

  let r = await uc.advanceItem(T, { ticketId, itemIndex: 0 });
  assert.equal(STATES[r.value.items[0].state], 'preparing');

  r = await uc.advanceItem(T, { ticketId, itemIndex: 0 });
  assert.equal(STATES[r.value.items[0].state], 'ready');

  // Advancing again stays capped at 'ready'.
  r = await uc.advanceItem(T, { ticketId, itemIndex: 0 });
  assert.equal(STATES[r.value.items[0].state], 'ready');
});

test('markAllReady makes isAllReady true and stages a ready event', async () => {
  const { uc, outbox } = setup();
  const created = await uc.receiveTicket(T, { orderId: 'ord_1', table: 'T1', items: sampleItems });
  const r = await uc.markAllReady(T, { ticketId: created.value.id });
  assert.ok(r.ok);
  assert.ok(isAllReady(r.value));
  const ready = outbox.peek().filter((e) => e.type === EVENTS.TicketReady);
  assert.equal(ready.length, 1);
});

test('allDay counts only not-ready items', async () => {
  const { uc } = setup();
  const created = await uc.receiveTicket(T, { orderId: 'ord_1', table: 'T1', items: sampleItems });
  const ticketId = created.value.id;

  // Initially all 3 items are not-ready.
  let r = await uc.allDay(T);
  assert.ok(r.ok);
  assert.equal(r.value.get('Paneer Tikka'), 1);
  assert.equal(r.value.get('Grilled Chicken'), 1);
  assert.equal(r.value.get('Garden Salad'), 1);

  // Bring 'Paneer Tikka' (index 0) all the way to ready.
  await uc.advanceItem(T, { ticketId, itemIndex: 0 });
  await uc.advanceItem(T, { ticketId, itemIndex: 0 });

  r = await uc.allDay(T);
  // No longer counted once ready.
  assert.equal(r.value.has('Paneer Tikka'), false);
  assert.equal(r.value.get('Grilled Chicken'), 1);
  assert.equal(r.value.get('Garden Salad'), 1);
});

test('getBoard returns tickets oldest-first', async () => {
  const { uc } = setup();
  const a = await uc.receiveTicket(T, { orderId: 'ord_a', table: 'T1', items: sampleItems });
  const b = await uc.receiveTicket(T, { orderId: 'ord_b', table: 'T2', items: sampleItems });
  const r = await uc.getBoard(T);
  assert.ok(r.ok);
  assert.equal(r.value.length, 2);
  // createdAt-ascending: 'a' was created no later than 'b'.
  assert.ok(r.value[0].createdAt <= r.value[1].createdAt);
  const ids = r.value.map((t) => t.id);
  assert.ok(ids.includes(a.value.id) && ids.includes(b.value.id));
});
