// Floor read-model. A table holds MANY orders/tickets across a meal, so a single
// stored "status" can't be correct. This derives each table's live status from
// its own tickets + open bill, leaving the stored floor doc (seating, waiter,
// move/swap) intact. The waiter floor map renders this view.
//
//   billing  — the table has an open (unpaid) bill
//   cooking  — at least one ticket still being made
//   ready    — at least one ticket all-ready, not yet served
//   seated   — occupied, nothing outstanding (between rounds / all served)
//   free     — unoccupied
import { ticketPhase } from '../../kitchen/src/domain/ticket.js';

function tableNumber(tableId) {
  const d = String(tableId ?? '').replace(/\D/g, '');
  return d ? parseInt(d, 10) : null;
}

/**
 * @param {object} floorDoc  stored floor aggregate ({ tables:[{n,status,order,waiterId}] })
 * @param {object[]} tickets  all kitchen tickets for the tenant
 * @param {object[]} openBills  open bills (e.g. billing.listOpen() values: {bill,totals})
 * @returns enriched floor doc with derived per-table status + ticket counts
 */
export function buildFloorView(floorDoc, tickets = [], openBills = []) {
  const byTable = new Map(); // n -> { cooking, ready }
  for (const t of tickets) {
    const n = tableNumber(t.table);
    if (n == null) continue;
    const g = byTable.get(n) || { cooking: 0, ready: 0 };
    const phase = ticketPhase(t);
    if (phase === 'cooking') g.cooking += 1;
    else if (phase === 'ready') g.ready += 1;
    byTable.set(n, g);
  }
  const billed = new Set(
    openBills.map((b) => tableNumber(b?.bill?.table ?? b?.table)).filter((n) => n != null),
  );

  const tables = (floorDoc.tables ?? []).map((tbl) => {
    const g = byTable.get(tbl.n) || { cooking: 0, ready: 0 };
    // Priority reflects what most needs a human's attention:
    // billing (settle) > ready (deliver now) > cooking (kitchen busy) > seated > free.
    let status;
    if (billed.has(tbl.n)) status = 'billing';
    else if (g.ready > 0) status = 'ready';
    else if (g.cooking > 0) status = 'cooking';
    else if (tbl.status === 'free' && !tbl.order) status = 'free';
    else status = 'seated';
    return { ...tbl, status, cookingCount: g.cooking, readyCount: g.ready };
  });

  return { ...floorDoc, tables };
}
