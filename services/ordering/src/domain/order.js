// Ordering domain — pure aggregate. No I/O, no framework. Trivially unit-testable.
import { Money, newId, DomainError, systemClock } from '#core';

// Customer-facing order lifecycle (the state machine from the spec).
const FLOW = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY'],
  READY: ['SERVED'],
  SERVED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function createOrder({ tenantId, tableId, items, sessionId = null, placedBy = 'customer', id = newId('ord'), clock = systemClock }) {
  const lines = items.map((it) => ({
    id: newId('ln'),
    menuItemId: it.menuItemId,
    name: it.name ?? it.menuItemId,
    qty: it.qty,
    unitPrice: new Money(it.unitPriceMinor, 'INR'),
  }));
  const subtotal = lines.reduce((m, l) => m.add(l.unitPrice.multiply(l.qty)), Money.zero('INR'));
  return {
    id, tenantId, tableId, sessionId, placedBy,
    status: 'PENDING',
    lines, subtotal,
    createdAt: clock.now().toISOString(),
  };
}

export function transition(order, to) {
  const allowed = FLOW[order.status] ?? [];
  if (!allowed.includes(to)) throw new DomainError('INVALID_TRANSITION', `Cannot move order ${order.status} -> ${to}`);
  return { ...order, status: to };
}

export function orderTotals(order, { gstPct = 5 } = {}) {
  const subtotal = order.subtotal;
  const tax = subtotal.percent(gstPct);
  const total = subtotal.add(tax);
  return { subtotal, tax, total };
}
