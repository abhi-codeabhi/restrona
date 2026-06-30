import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedClock } from '#core';
import { createOrder, transition, orderTotals } from '../src/domain/order.js';
import { openSession, addSharedItem, computeSplit } from '../src/domain/session.js';

const clock = fixedClock('2026-06-28T12:00:00Z');

test('createOrder computes subtotal from lines', () => {
  const o = createOrder({
    tenantId: 't1', tableId: 'T12', clock,
    items: [
      { menuItemId: 'paneer', unitPriceMinor: 24000, qty: 1 }, // ₹240
      { menuItemId: 'naan', unitPriceMinor: 6000, qty: 2 },    // ₹60 x2
    ],
  });
  assert.equal(o.subtotal.minor, 36000); // ₹360.00
  assert.equal(o.status, 'PENDING');
  assert.equal(o.lines.length, 2);
});

test('orderTotals adds GST', () => {
  const o = createOrder({ tenantId: 't1', tableId: 'T1', clock, items: [{ menuItemId: 'x', unitPriceMinor: 10000, qty: 1 }] });
  const { tax, total } = orderTotals(o, { gstPct: 5 });
  assert.equal(tax.minor, 500);     // ₹5
  assert.equal(total.minor, 10500); // ₹105
});

test('transition enforces the state machine', () => {
  const o = createOrder({ tenantId: 't1', tableId: 'T1', clock, items: [{ menuItemId: 'x', unitPriceMinor: 100, qty: 1 }] });
  const confirmed = transition(o, 'CONFIRMED');
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.throws(() => transition(o, 'SERVED'), (e) => e.code === 'INVALID_TRANSITION'); // PENDING -> SERVED illegal
});

test('computeSplit: by_item = own items + equal share of shared, with GST', () => {
  let s = openSession({ tenantId: 't1', tableId: 'T12', participants: [{ id: 'Y' }, { id: 'R' }] });
  s = addSharedItem(s, { participantId: 'Y', name: 'Paneer', priceMinor: 24000 });   // Y only
  s = addSharedItem(s, { name: 'Platter', priceMinor: 46000, shared: true });        // shared / 2
  const split = computeSplit(s, { mode: 'by_item', gstPct: 5 });
  // Y: (24000 + 23000) * 1.05 = 49350 ; R: 23000 * 1.05 = 24150
  assert.equal(split.Y.minor, 49350);
  assert.equal(split.R.minor, 24150);
});

test('computeSplit: even mode divides the whole bill', () => {
  let s = openSession({ tenantId: 't1', tableId: 'T1', participants: [{ id: 'A' }, { id: 'B' }] });
  s = addSharedItem(s, { name: 'X', priceMinor: 20000, shared: true });
  const split = computeSplit(s, { mode: 'even', gstPct: 5 });
  // total 20000 *1.05 = 21000 / 2 = 10500 each
  assert.equal(split.A.minor, 10500);
  assert.equal(split.B.minor, 10500);
});
