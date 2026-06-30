// Application layer — kitchen use cases orchestrate domain + ports.
// Local event constants + validators only (dependency-free; no #contracts).
import { ok, err, NotFoundError, ValidationError, newId } from '#core';
import {
  createTicketFromOrder,
  advanceItem as advanceItemDomain,
  bumpAll,
  isAllReady,
  markServed,
  ticketPhase,
  allDayCounts,
  oldestFirst,
} from '../domain/ticket.js';

// Local event constants for the kitchen bounded context.
export const EVENTS = {
  TicketFired: 'kitchen.ticket.fired',
  TicketReady: 'kitchen.ticket.ready',
  TicketServed: 'kitchen.ticket.served',
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

    // Advance one item new -> preparing -> ready (stays at ready). When this makes
    // the WHOLE ticket ready, notify the floor (same signal as a bump) so the
    // waiter sees "ready to serve" whether the cook bumped or finished item-by-item.
    async advanceItem(tenant, { ticketId, itemIndex }) {
      const existing = await tickets.findById(tenant, ticketId);
      if (!existing) return err(new NotFoundError(`Ticket ${ticketId} not found`));
      const wasReady = isAllReady(existing);
      const updated = advanceItemDomain(existing, itemIndex);
      await tickets.save(tenant, updated);
      if (!wasReady && isAllReady(updated)) {
        outbox.add(evt(EVENTS.TicketReady, tenant.tenantId, {
          ticketId: updated.id, orderId: updated.orderId, table: updated.table,
        }));
      }
      return ok(updated);
    },

    // Bump the whole ticket to ready; when fully ready, stage kitchen.ticket.ready.
    // After bump the ticket is done in the kitchen and drops off the active board
    // (getBoard filters fully-ready tickets) — the "ready to serve" hand-off now
    // lives on the waiter's floor (table -> ready), not the cook's screen.
    async markAllReady(tenant, { ticketId }) {
      const existing = await tickets.findById(tenant, ticketId);
      if (!existing) return err(new NotFoundError(`Ticket ${ticketId} not found`));
      const wasReady = isAllReady(existing);
      const updated = bumpAll(existing);
      await tickets.save(tenant, updated);
      if (!wasReady && isAllReady(updated)) {
        outbox.add(evt(EVENTS.TicketReady, tenant.tenantId, {
          ticketId: updated.id,
          orderId: updated.orderId,
          table: updated.table,
        }));
      }
      return ok(updated);
    },

    // Waiter delivers ONE ready ticket to the table. Marks just that ticket
    // served — other tickets for the same table (still cooking, or another ready
    // round) are untouched. This is why serving order #1 never serves order #2.
    async serveTicket(tenant, { ticketId }) {
      const existing = await tickets.findById(tenant, ticketId);
      if (!existing) return err(new NotFoundError(`Ticket ${ticketId} not found`));
      const updated = markServed(existing);
      await tickets.save(tenant, updated);
      outbox.add(evt(EVENTS.TicketServed, tenant.tenantId, {
        ticketId: updated.id, orderId: updated.orderId, table: updated.table,
      }));
      return ok(updated);
    },

    // Move every live ticket from one table label to another (waiter move/swap),
    // so the kitchen + serve queue follow the party. Tolerant table matching.
    async relocateTickets(tenant, fromTable, toTable) {
      const key = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return d || String(v ?? ''); };
      const from = key(fromTable);
      const all = await tickets.list(tenant);
      let n = 0;
      for (const t of all) {
        if (key(t.table) === from && !t.served) { await tickets.save(tenant, { ...t, table: toTable }); n++; }
      }
      return ok(n);
    },

    // The active KITCHEN board: tickets still being cooked, oldest first.
    // Ready (bumped) and served tickets have left the cook's screen.
    async getBoard(tenant) {
      const all = await tickets.list(tenant);
      return ok(oldestFirst(all.filter((t) => ticketPhase(t) === 'cooking')));
    },

    // The WAITER serve queue: tickets that are all-ready but not yet delivered.
    // One entry per order, so each round is served independently.
    async readyQueue(tenant) {
      const all = await tickets.list(tenant);
      return ok(oldestFirst(all.filter((t) => ticketPhase(t) === 'ready')));
    },

    // The all-day rail: counts of not-yet-ready items across the board.
    async allDay(tenant) {
      const all = await tickets.list(tenant);
      return ok(allDayCounts(all));
    },
  };
}
