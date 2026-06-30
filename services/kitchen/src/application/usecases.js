// Application layer — kitchen use cases orchestrate domain + ports.
// Local event constants + validators only (dependency-free; no #contracts).
import { ok, err, NotFoundError, ValidationError, newId } from '#core';
import {
  createTicketFromOrder,
  advanceItem as advanceItemDomain,
  bumpAll,
  isAllReady,
  allDayCounts,
  oldestFirst,
} from '../domain/ticket.js';

// Local event constants for the kitchen bounded context.
export const EVENTS = {
  TicketFired: 'kitchen.ticket.fired',
  TicketReady: 'kitchen.ticket.ready',
};

// Event envelope helper (matches the outbox `add(evt)` shape).
const evt = (type, tenantId, payload) => ({
  id: newId('evt'),
  type,
  tenantId,
  occurredAt: new Date().toISOString(),
  schemaVersion: 1,
  payload,
});

// Local validators — return Result<value, ValidationError>.
function validateReceiveTicket(input) {
  const details = [];
  if (!input || typeof input !== 'object') details.push({ field: 'input', msg: 'required' });
  const { orderId, table, items } = input ?? {};
  if (!orderId) details.push({ field: 'orderId', msg: 'required' });
  if (!table) details.push({ field: 'table', msg: 'required' });
  if (!Array.isArray(items) || items.length === 0) details.push({ field: 'items', msg: 'at least one item required' });
  else items.forEach((it, i) => { if (!it || !it.name) details.push({ field: `items[${i}].name`, msg: 'required' }); });
  if (details.length) return err(new ValidationError('Invalid receiveTicket input', details));
  return ok({ orderId, table, items });
}

export function makeKitchenUseCases({ tickets, outbox, clock }) {
  return {
    // Fire a new ticket onto the board from an order; stage kitchen.ticket.fired.
    async receiveTicket(tenant, input) {
      const v = validateReceiveTicket(input);
      if (!v.ok) return v;
      const ticket = createTicketFromOrder({ ...v.value, clock });
      await tickets.save(tenant, ticket);
      outbox.add(evt(EVENTS.TicketFired, tenant.tenantId, {
        ticketId: ticket.id,
        orderId: ticket.orderId,
        table: ticket.table,
        items: ticket.items.map((it) => ({ name: it.name, station: it.station })),
      }));
      return ok(ticket);
    },

    // Advance one item new -> preparing -> ready (stays at ready).
    async advanceItem(tenant, { ticketId, itemIndex }) {
      const existing = await tickets.findById(tenant, ticketId);
      if (!existing) return err(new NotFoundError(`Ticket ${ticketId} not found`));
      const updated = advanceItemDomain(existing, itemIndex);
      await tickets.save(tenant, updated);
      return ok(updated);
    },

    // Bump the whole ticket to ready; when fully ready, stage kitchen.ticket.ready.
    async markAllReady(tenant, { ticketId }) {
      const existing = await tickets.findById(tenant, ticketId);
      if (!existing) return err(new NotFoundError(`Ticket ${ticketId} not found`));
      const updated = bumpAll(existing);
      await tickets.save(tenant, updated);
      if (isAllReady(updated)) {
        outbox.add(evt(EVENTS.TicketReady, tenant.tenantId, {
          ticketId: updated.id,
          orderId: updated.orderId,
          table: updated.table,
        }));
      }
      return ok(updated);
    },

    // The board: live tickets, oldest first.
    async getBoard(tenant) {
      const all = await tickets.list(tenant);
      return ok(oldestFirst(all));
    },

    // The all-day rail: counts of not-yet-ready items across the board.
    async allDay(tenant) {
      const all = await tickets.list(tenant);
      return ok(allDayCounts(all));
    },
  };
}
