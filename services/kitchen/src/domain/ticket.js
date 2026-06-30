// Kitchen (KDS) domain — pure aggregate. No I/O, no framework. Unit-testable.
// A "ticket" is a fired order on the kitchen display: a list of items, each routed
// to a station (grill | tandoor | cold), progressing new -> preparing -> ready.
import { newId, systemClock } from '#core';

// Per-item state machine. Index into this array IS the persisted state (0..2).
export const STATES = ['new', 'preparing', 'ready'];

const STATIONS = new Set(['grill', 'tandoor', 'cold']);

// Build a ticket from an order. Each item starts at state 0 ('new').
export function createTicketFromOrder({ orderId, table, items, id = newId('tkt'), clock = systemClock }) {
  const ticketItems = (items ?? []).map((it) => ({
    id: newId('ti'),
    name: it.name,
    station: STATIONS.has(it.station) ? it.station : 'grill',
    mods: it.mods ?? [],
    state: 0, // index into STATES => 'new'
  }));
  return {
    id,
    orderId,
    table,
    items: ticketItems,
    createdAt: clock.now().toISOString(),
  };
}

// Cycle a single item new -> preparing -> ready, capped at 'ready'.
// Returns a new ticket (immutable update).
export function advanceItem(ticket, itemIndex) {
  const items = ticket.items.map((it, i) =>
    i === itemIndex ? { ...it, state: Math.min(it.state + 1, STATES.length - 1) } : it,
  );
  return { ...ticket, items };
}

// Bump the whole ticket: every item jumps to 'ready'.
export function bumpAll(ticket) {
  const ready = STATES.length - 1;
  return { ...ticket, items: ticket.items.map((it) => ({ ...it, state: ready })) };
}

// True when every item on the ticket has reached 'ready'.
export function isAllReady(ticket) {
  return ticket.items.length > 0 && ticket.items.every((it) => it.state === STATES.length - 1);
}

// The "all-day rail": across all live tickets, how many of each item are NOT yet
// ready — i.e. the running work the kitchen still owes. Map of itemName -> count.
export function allDayCounts(tickets) {
  const counts = new Map();
  const ready = STATES.length - 1;
  for (const ticket of tickets) {
    for (const it of ticket.items) {
      if (it.state < ready) counts.set(it.name, (counts.get(it.name) ?? 0) + 1);
    }
  }
  return counts;
}

// Course/priority helper: oldest tickets first (FIFO expo discipline).
export function oldestFirst(tickets) {
  return [...tickets].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}
