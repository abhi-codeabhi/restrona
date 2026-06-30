// Application layer — use cases orchestrate domain + ports. Depend on PORTS, not impls.
import { ok, err, NotFoundError } from '#core';
import { EVENTS, envelope, validatePlaceOrder, validateOpenSession, validateAddSharedItem } from '#contracts';
import { createOrder, orderTotals } from '../domain/order.js';
import { openSession, addSharedItem, computeSplit } from '../domain/session.js';

export function makeUseCases({ orders, sessions, outbox, clock }) {
  return {
    async placeOrder(tenant, input) {
      const v = validatePlaceOrder(input);
      if (!v.ok) return v;
      const order = createOrder({ tenantId: tenant.tenantId, ...v.value, clock });
      await orders.save(tenant, order);
      const totals = orderTotals(order);
      // business write + event would be ONE transaction in prod (outbox).
      outbox.add(envelope(EVENTS.OrderPlaced, tenant.tenantId, {
        orderId: order.id, tableId: order.tableId,
        totalMinor: totals.total.minor,
        lines: order.lines.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty })),
      }));
      return ok({ order, totals });
    },

    async getOrder(tenant, id) {
      const order = await orders.findById(tenant, id);
      if (!order) return err(new NotFoundError(`Order ${id} not found`));
      return ok({ order, totals: orderTotals(order) });
    },

    async listOrders(tenant) {
      return ok(await orders.list(tenant));
    },

    // All orders for a table. Dine-in guests order several times across a meal;
    // by default this returns only the not-yet-billed ones (what a final bill
    // should aggregate). Pass includeBilled to see the whole table history.
    async listForTable(tenant, table, { includeBilled = false } = {}) {
      const all = await orders.list(tenant);
      return ok(all.filter((o) => o.tableId === table && (includeBilled || !o.billed)));
    },

    // Mark an order as included in a finalized bill so it isn't billed twice.
    async markBilled(tenant, orderId) {
      const order = await orders.findById(tenant, orderId);
      if (!order) return err(new NotFoundError(`Order ${orderId} not found`));
      const updated = { ...order, billed: true, billedAt: clock.now().toISOString() };
      await orders.save(tenant, updated);
      return ok(updated);
    },

    async openSession(tenant, input) {
      const v = validateOpenSession(input);
      if (!v.ok) return v;
      const session = openSession({ tenantId: tenant.tenantId, ...v.value });
      await sessions.save(tenant, session);
      outbox.add(envelope(EVENTS.SessionOpened, tenant.tenantId, { sessionId: session.id, tableId: session.tableId }));
      return ok(session);
    },

    async addSharedItem(tenant, sessionId, input) {
      const v = validateAddSharedItem(input);
      if (!v.ok) return v;
      const existing = await sessions.findById(tenant, sessionId);
      if (!existing) return err(new NotFoundError(`Session ${sessionId} not found`));
      const updated = addSharedItem(existing, v.value);
      await sessions.save(tenant, updated);
      outbox.add(envelope(EVENTS.SessionItemAdded, tenant.tenantId, { sessionId, name: v.value.name }));
      return ok(updated);
    },

    async getSplit(tenant, sessionId, mode = 'by_item') {
      const session = await sessions.findById(tenant, sessionId);
      if (!session) return err(new NotFoundError(`Session ${sessionId} not found`));
      const split = computeSplit(session, { mode });
      return ok({ sessionId, mode, split });
    },
  };
}
