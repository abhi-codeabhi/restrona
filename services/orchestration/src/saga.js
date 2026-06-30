// Order-flow saga (process manager) — the missing "brain" that connects the
// bounded contexts so an order actually travels customer -> kitchen -> waiter ->
// billing. It owns NO data and NO business rules: it only listens for domain
// events on the shared bus and calls the relevant context's use cases in
// response. This is what makes the surfaces feel like one live system.
//
//   OrderPlaced  ─▶ create a kitchen ticket (KDS board updates)
//                └▶ seat the order's table + mark it 'cooking' (waiter sees it)
//   TicketReady  ─▶ mark the table 'ready' (waiter's "serve" feed)
//
// NOTE: billing is deliberately NOT here. Dine-in guests don't pay per order —
// they order several times across a meal and the waiter/billing agent generates
// ONE final bill aggregating the table's orders on request (see openTableBill).
//
// Storage-agnostic: works identically over in-memory or Postgres repositories,
// because it only touches use cases. Idempotency is best-effort for the demo;
// the production version would dedupe on event id + a processed-events table.

import { EVENTS as ORDER_EVENTS } from '#contracts';

// Kitchen emits its own local event names (not in the shared #contracts taxonomy).
const KITCHEN_TICKET_READY = 'kitchen.ticket.ready';

// Map a menu item to a kitchen station from its dietary tags. Cosmetic routing
// for the KDS; defaults to 'grill' when nothing better is known.
function stationFor(item) {
  const t = (item && item.tags) || {};
  if (t.gluten) return 'tandoor';                 // breads / naan / roti
  if (t.meat || t.fish || t.egg) return 'grill';  // proteins
  if (t.sugar && !t.meat && !t.fish) return 'cold'; // drinks / desserts
  return 'grill';
}

// Pull a numeric table number out of whatever the order carried ("T7" -> 7).
function tableNumber(tableId) {
  const digits = String(tableId ?? '').replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : null;
}

function tenantOf(evt) {
  return { tenantId: evt.tenantId, tier: 'T1_POOLED', region: 'ap-mumbai-1' };
}

/**
 * Wire the saga onto a shared event bus.
 * @param {object} deps
 * @param {import('#events').InMemoryEventBus} deps.bus  shared bus
 * @param {object} deps.useCases  { catalog, ordering, kitchen, floor, billing }
 * @param {object} [deps.logger]
 * @returns {() => void} unsubscribe-all
 */
export function registerOrderFlowSaga({ bus, useCases, logger }) {
  const { catalog, ordering, kitchen, floor, billing } = useCases;
  const log = logger || { info() {}, warn() {}, error() {} };

  // ── OrderPlaced ▶ kitchen ticket + floor seat/cooking ───────────────────────
  const offPlaced = bus.subscribe(ORDER_EVENTS.OrderPlaced, async (evt) => {
    const tenant = tenantOf(evt);
    const { orderId, tableId, lines = [] } = evt.payload || {};
    try {
      // Resolve each order line into named, per-unit kitchen items.
      const items = [];
      for (const ln of lines) {
        let name = ln.name || ln.menuItemId;
        let station = 'grill';
        if (ln.menuItemId && catalog?.getItem) {
          const r = await catalog.getItem(tenant, ln.menuItemId);
          if (r.ok) { name = r.value.name; station = stationFor(r.value); }
        }
        const qty = Number.isInteger(ln.qty) && ln.qty > 0 ? ln.qty : 1;
        for (let i = 0; i < qty; i++) items.push({ name, station });
      }
      if (kitchen?.receiveTicket && items.length) {
        const rk = await kitchen.receiveTicket(tenant, { orderId, table: tableId, items });
        if (!rk.ok) log.warn('saga.kitchen.receiveTicket.failed', { orderId, error: rk.error?.message });
      }

      // Seat the table and mark it cooking so the waiter floor reflects it.
      const n = tableNumber(tableId);
      if (n != null && floor?.ensureTable) {
        await floor.ensureTable(tenant, { n });
        const rf = await floor.setTableStatus(tenant, { n, status: 'cooking', order: orderId });
        if (!rf.ok) log.warn('saga.floor.cooking.failed', { n, error: rf.error?.message });
      }
      log.info('saga.orderPlaced.handled', { orderId, table: tableId, units: items.length });
    } catch (e) {
      log.error('saga.orderPlaced.error', { orderId, error: e?.message });
    }
  });

  // ── TicketReady ▶ floor 'ready' (waiter's serve feed) ───────────────────────
  const offReady = bus.subscribe(KITCHEN_TICKET_READY, async (evt) => {
    const tenant = tenantOf(evt);
    const { orderId, table } = evt.payload || {};
    try {
      const n = tableNumber(table);
      if (n != null && floor?.setTableStatus) {
        const rf = await floor.setTableStatus(tenant, { n, status: 'ready' });
        if (!rf.ok) log.warn('saga.floor.ready.failed', { n, error: rf.error?.message });
      }
      log.info('saga.ticketReady.handled', { orderId, table });
    } catch (e) {
      log.error('saga.ticketReady.error', { orderId, error: e?.message });
    }
  });

  return () => { offPlaced(); offReady(); };
}
