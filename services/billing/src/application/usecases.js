// Application layer — billing use cases orchestrate domain + ports.
// Depend on PORTS (repo, outbox, clock), not impls. Dependency-free.
// Local event constants + validators (this service owns its contracts).
import { ok, err, ValidationError, NotFoundError, newId } from '#core';
import {
  openBill,
  computeTotals,
  applyDiscount as applyDiscountToBill,
  split,
  recordPayment as recordPaymentOnBill,
} from '../domain/bill.js';
import { reconcile as reconcilePayments } from '../domain/reconciliation.js';

/* ---------- Event taxonomy: restorna.<context>.<aggregate>.<event>.vN ---------- */
export const EVENTS = Object.freeze({
  BillOpened: 'restorna.billing.bill.opened.v1',
  DiscountApplied: 'restorna.billing.bill.discount_applied.v1',
  PaymentCaptured: 'restorna.billing.payment.captured.v1',
  BillFinalized: 'restorna.billing.bill.finalized.v1',
});

/** CloudEvents-style envelope (local to this service). */
export const evt = (type, tenantId, payload) => ({
  id: newId('evt'),
  type,
  tenantId,
  occurredAt: new Date().toISOString(),
  schemaVersion: 1,
  payload,
});

/* ---------- Command validators (dependency-free, Result-returning) ---------- */
export function validateOpenBill(input) {
  const e = [];
  if (!input || typeof input !== 'object') return err(new ValidationError('Request body required'));
  if (!input.orderId) e.push('orderId is required');
  if (!Array.isArray(input.lines) || input.lines.length === 0) e.push('lines must be a non-empty array');
  else input.lines.forEach((l, i) => {
    if (!l.name) e.push(`lines[${i}].name is required`);
    if (!Number.isInteger(l.priceMinor) || l.priceMinor <= 0) e.push(`lines[${i}].priceMinor must be a positive integer (paise)`);
    if (!l.shared && !l.participantId) {
      // participant is optional for non-split bills; only required conceptually for by_item splits.
    }
  });
  return e.length ? err(new ValidationError('Invalid bill', e)) : ok(input);
}

export function validateRecordPayment(input) {
  const e = [];
  if (!input || typeof input !== 'object') return err(new ValidationError('Request body required'));
  const methods = ['card', 'cash', 'upi', 'split'];
  if (!methods.includes(input.method)) e.push(`method must be one of ${methods.join('|')}`);
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) e.push('amountMinor must be a positive integer (paise)');
  return e.length ? err(new ValidationError('Invalid payment', e)) : ok(input);
}

export function makeBillingUseCases({ bills, outbox, clock }) {
  return {
    async openBill(tenant, input) {
      const v = validateOpenBill(input);
      if (!v.ok) return v;
      const bill = openBill({ orderId: v.value.orderId, table: v.value.table, lines: v.value.lines, clock });
      await bills.save(tenant, bill);
      const totals = computeTotals(bill, v.value.totalsOpts);
      outbox.add(evt(EVENTS.BillOpened, tenant.tenantId, {
        billId: bill.id, orderId: bill.orderId, table: bill.table, totalMinor: totals.total.minor,
      }));
      return ok({ bill, totals });
    },

    async getBill(tenant, id) {
      const bill = await bills.findById(tenant, id);
      if (!bill) return err(new NotFoundError(`Bill ${id} not found`));
      return ok({ bill, totals: computeTotals(bill) });
    },

    // Open (unpaid) bills with their computed totals — the billing surface's queue.
    async listOpen(tenant) {
      const all = await bills.list(tenant);
      const open = all.filter((b) => b.status === 'open');
      return ok(open.map((bill) => ({ bill, totals: computeTotals(bill) })));
    },

    async applyDiscount(tenant, billId, { minor, reason } = {}) {
      const existing = await bills.findById(tenant, billId);
      if (!existing) return err(new NotFoundError(`Bill ${billId} not found`));
      if (!Number.isInteger(minor) || minor <= 0) return err(new ValidationError('Invalid discount', ['minor must be a positive integer (paise)']));
      const updated = applyDiscountToBill(existing, minor, reason);
      await bills.save(tenant, updated);
      outbox.add(evt(EVENTS.DiscountApplied, tenant.tenantId, { billId, minor, reason: reason ?? 'discount' }));
      return ok({ bill: updated, totals: computeTotals(updated) });
    },

    async splitBill(tenant, billId, { mode = 'even' } = {}) {
      const bill = await bills.findById(tenant, billId);
      if (!bill) return err(new NotFoundError(`Bill ${billId} not found`));
      const shares = split(bill, { mode });
      return ok({ billId, mode, split: shares });
    },

    async recordPayment(tenant, billId, input) {
      const v = validateRecordPayment(input);
      if (!v.ok) return v;
      const existing = await bills.findById(tenant, billId);
      if (!existing) return err(new NotFoundError(`Bill ${billId} not found`));
      const totals = computeTotals(existing);
      const updated = recordPaymentOnBill(existing, { ...v.value, totals }, clock);
      await bills.save(tenant, updated);

      const payment = updated.payments[updated.payments.length - 1];
      outbox.add(evt(EVENTS.PaymentCaptured, tenant.tenantId, {
        billId, paymentId: payment.id, method: payment.method, amountMinor: payment.amountMinor,
      }));

      if (updated.paid) {
        outbox.add(evt(EVENTS.BillFinalized, tenant.tenantId, {
          billId, orderId: updated.orderId, totalMinor: totals.total.minor,
        }));
      }
      return ok({ bill: updated, totals, paid: updated.paid });
    },

    async reconcile(tenant, { payments, bankSettlements } = {}) {
      const result = reconcilePayments(payments ?? [], bankSettlements ?? []);
      return ok(result);
    },
  };
}
