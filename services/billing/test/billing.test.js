import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemClock, fixedClock, Money } from '#core';
import { InMemoryOutbox, InMemoryEventBus } from '#events';
import { openBill, computeTotals, applyDiscount, split, recordPayment } from '../src/domain/bill.js';
import { reconcile } from '../src/domain/reconciliation.js';
import { InMemoryBillRepository } from '../src/adapters/repos.js';
import { makeBillingUseCases, EVENTS } from '../src/application/usecases.js';

const clock = fixedClock('2026-06-30T12:00:00Z');
const T = { tenantId: 'acme', tier: 'T1_POOLED', region: 'ap-mumbai-1' };

function setup() {
  const bills = new InMemoryBillRepository();
  const outbox = new InMemoryOutbox();
  const bus = new InMemoryEventBus();
  const uc = makeBillingUseCases({ bills, outbox, clock: systemClock });
  return { uc, bills, outbox, bus };
}

test('computeTotals: gst5 + flat discount is correct', () => {
  const bill = openBill({
    orderId: 'ord1', table: 'T12', clock,
    lines: [
      { name: 'Paneer', priceMinor: 24000 }, // ₹240
      { name: 'Naan', priceMinor: 6000 },     // ₹60
    ],
  }); // subtotal 30000
  const withDiscount = applyDiscount(bill, 5000, 'loyalty'); // -₹50
  const t = computeTotals(withDiscount, { gstPct: 5 });
  assert.equal(t.subtotal.minor, 30000);
  assert.equal(t.discount.minor, 5000);
  // taxable = 25000 ; gst = 1250 ; total = 26250
  assert.equal(t.tax.minor, 1250);
  assert.equal(t.total.minor, 26250);
  assert.ok(t.subtotal instanceof Money && t.total instanceof Money);
});

test('split by_item sums to the bill total (within rounding)', () => {
  const bill = openBill({
    orderId: 'ord2', table: 'T7', clock,
    lines: [
      { name: 'Paneer', priceMinor: 24000, participantId: 'Y' },
      { name: 'Dal', priceMinor: 18000, participantId: 'R' },
      { name: 'Platter', priceMinor: 46000, shared: true },
    ],
  });
  const shares = split(bill, { mode: 'by_item' });
  const sumMinor = Object.values(shares).reduce((s, m) => s + m.minor, 0);
  const { total } = computeTotals(bill, { gstPct: 5 });
  assert.ok(Math.abs(sumMinor - total.minor) <= 2, `shares ${sumMinor} vs total ${total.minor}`);
});

test('split even/by_guest divides the whole bill incl gst', () => {
  const bill = openBill({
    orderId: 'ord3', table: 'T1', clock,
    lines: [
      { name: 'A', priceMinor: 20000, participantId: 'A' },
      { name: 'B', priceMinor: 20000, participantId: 'B' },
    ],
  });
  const even = split(bill, { mode: 'even' });
  const guest = split(bill, { mode: 'by_guest' });
  const { total } = computeTotals(bill, { gstPct: 5 }); // 40000 * 1.05 = 42000
  assert.equal(total.minor, 42000);
  const sumEven = Object.values(even).reduce((s, m) => s + m.minor, 0);
  assert.equal(sumEven, 42000);
  assert.equal(even.A.minor, guest.A.minor); // by_guest is alias of even
});

test('recordPayment covering the total marks paid + stages bill.finalized', async () => {
  const { uc, outbox } = setup();
  const opened = await uc.openBill(T, {
    orderId: 'ord4', table: 'T9',
    lines: [{ name: 'Combo', priceMinor: 100000 }],
  });
  assert.ok(opened.ok);
  const billId = opened.value.bill.id;
  const total = opened.value.totals.total.minor; // 105000

  outbox.peek().length; // BillOpened staged
  const r = await uc.recordPayment(T, billId, { method: 'card', amountMinor: total });
  assert.ok(r.ok);
  assert.equal(r.value.paid, true);
  assert.equal(r.value.bill.status, 'paid');

  const types = outbox.peek().map((e) => e.type);
  assert.ok(types.includes(EVENTS.PaymentCaptured));
  assert.ok(types.includes(EVENTS.BillFinalized));
});

test('recordPayment domain: partial payment leaves bill open', () => {
  const bill = openBill({ orderId: 'o', table: 'T', clock, lines: [{ name: 'X', priceMinor: 100000 }] });
  const totals = computeTotals(bill); // total 105000
  const after = recordPayment(bill, { method: 'cash', amountMinor: 50000, tenderedMinor: 50000, totals }, clock);
  assert.equal(after.paid, false);
  assert.equal(after.status, 'open');
  assert.equal(after.payments.length, 1);
});

test('reconcile flags a mismatch when a settlement amount differs', () => {
  const payments = [
    { id: 'pay1', ref: 'TXN-A', amountMinor: 105000 },
    { id: 'pay2', ref: 'TXN-B', amountMinor: 50000 },
  ];
  const settlements = [
    { ref: 'TXN-A', amountMinor: 105000 }, // matches
    { ref: 'TXN-B', amountMinor: 49900 },  // short by ₹1 -> mismatch
  ];
  const { matched, mismatches } = reconcile(payments, settlements);
  assert.equal(matched.minor, 105000);
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].paymentId, 'pay2');
  assert.equal(mismatches[0].expected.minor, 50000);
  assert.equal(mismatches[0].settled.minor, 49900);
});
