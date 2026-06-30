// Billing domain — pure aggregate. No I/O, no framework. Trivially unit-testable.
// Money is INTEGER MINOR UNITS (paise). All totals returned as Money value objects.
import { Money, newId, DomainError, systemClock } from '#core';

const INR = 'INR';

/**
 * Open a bill for an order/table.
 * lines = [{ name, priceMinor, participantId?, shared? }]
 * status: open | paid | void
 */
export function openBill({ orderId, table, lines = [], id = newId('bill'), clock = systemClock }) {
  const billLines = lines.map((l) => ({
    id: newId('bl'),
    name: l.name,
    price: new Money(l.priceMinor, INR),
    participantId: l.shared ? null : (l.participantId ?? null),
    shared: !!l.shared,
  }));
  return {
    id,
    orderId,
    table,
    lines: billLines,
    discounts: [],   // [{ minor, reason }]
    payments: [],    // [{ id, method, amountMinor, tenderedMinor?, changeMinor?, ref?, at }]
    status: 'open',
    paid: false,
    createdAt: clock.now().toISOString(),
  };
}

/** Sum of all line prices (pre-tax, pre-discount). */
function lineSubtotal(bill) {
  return bill.lines.reduce((m, l) => m.add(l.price), Money.zero(INR));
}

/** Sum of recorded discounts (minor units). */
function discountTotalMinor(bill) {
  return bill.discounts.reduce((s, d) => s + d.minor, 0);
}

/**
 * Compute totals. Tax (GST) is applied on the post-discount subtotal; service
 * charge is applied on the pre-tax (post-discount) subtotal. Returns Money's.
 */
export function computeTotals(bill, { gstPct = 5, serviceChargePct = 0, discountMinor = 0 } = {}) {
  const subtotal = lineSubtotal(bill);
  const recorded = discountTotalMinor(bill);
  const discount = new Money(recorded + discountMinor, INR);
  const taxableMinor = Math.max(0, subtotal.minor - discount.minor);
  const taxable = new Money(taxableMinor, INR);
  const serviceCharge = taxable.percent(serviceChargePct);
  const tax = taxable.percent(gstPct);
  const total = taxable.add(serviceCharge).add(tax);
  return { subtotal, tax, serviceCharge, discount, total };
}

/** Record a flat discount (minor units) with a reason; returns updated bill. */
export function applyDiscount(bill, minor, reason) {
  if (!Number.isInteger(minor) || minor <= 0) {
    throw new DomainError('INVALID_DISCOUNT', 'Discount must be a positive integer (paise)');
  }
  return { ...bill, discounts: [...bill.discounts, { minor, reason: reason ?? 'discount' }] };
}

/**
 * Split a bill across participants. Returns { participantId: Money }.
 *   'even'     — whole bill (incl. gst) divided equally among participants.
 *   'by_guest' — alias of 'even'.
 *   'by_item'  — each guest pays for their own items + equal share of shared
 *                items; GST applied on each guest's share.
 */
export function split(bill, { mode = 'even', gstPct = 5 } = {}) {
  const participants = [...new Set(
    bill.lines.filter((l) => !l.shared && l.participantId).map((l) => l.participantId),
  )];
  const per = {};
  const n = participants.length || 1;
  participants.forEach((p) => { per[p] = Money.zero(INR); });

  if (mode === 'even' || mode === 'by_guest') {
    const { total } = computeTotals(bill, { gstPct });
    const each = Math.round(total.minor / n);
    let allocated = 0;
    participants.forEach((p, i) => {
      // Give the rounding remainder to the last participant so shares sum to total.
      const share = i === participants.length - 1 ? total.minor - allocated : each;
      allocated += share;
      per[p] = new Money(share, INR);
    });
    return per;
  }

  if (mode === 'by_item') {
    const sharedTotal = bill.lines.filter((l) => l.shared).reduce((m, l) => m.add(l.price), Money.zero(INR));
    const sharePerHead = Math.round(sharedTotal.minor / n);
    bill.lines.forEach((l) => {
      if (!l.shared && per[l.participantId] !== undefined) per[l.participantId] = per[l.participantId].add(l.price);
    });
    participants.forEach((p) => {
      const base = per[p].add(new Money(sharePerHead, INR));
      per[p] = base.add(base.percent(gstPct)); // GST on each share
    });
    return per;
  }

  throw new DomainError('UNKNOWN_SPLIT_MODE', `Unknown split mode: ${mode}`);
}

/**
 * Record a payment against the bill. Marks paid=true (and status 'paid') once
 * the sum of payments covers the computed total. method: card|cash|upi|split.
 */
export function recordPayment(bill, { method, amountMinor, tenderedMinor, ref, totals } = {}, clock = systemClock) {
  const allowed = ['card', 'cash', 'upi', 'split'];
  if (!allowed.includes(method)) throw new DomainError('INVALID_METHOD', `Unknown payment method: ${method}`);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new DomainError('INVALID_AMOUNT', 'amountMinor must be a positive integer (paise)');
  }
  const { total } = totals ?? computeTotals(bill);
  const payment = {
    id: newId('pay'),
    method,
    amountMinor,
    ref: ref ?? null,
    at: clock.now().toISOString(),
  };
  if (method === 'cash' && Number.isInteger(tenderedMinor)) {
    payment.tenderedMinor = tenderedMinor;
    payment.changeMinor = Math.max(0, tenderedMinor - amountMinor);
  }
  const payments = [...bill.payments, payment];
  const paidMinor = payments.reduce((s, p) => s + p.amountMinor, 0);
  const paid = paidMinor >= total.minor;
  return { ...bill, payments, paid, status: paid ? 'paid' : bill.status };
}

/** Total paid so far (minor units). */
export function paidMinor(bill) {
  return bill.payments.reduce((s, p) => s + p.amountMinor, 0);
}
