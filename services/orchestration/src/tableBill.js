// Table-level billing — the dine-in "ask for the bill" flow.
//
// A guest orders several times across a meal; no money changes hands until the
// end. When the waiter or billing agent initiates the bill for a table, this
// orchestration gathers EVERY not-yet-billed order for that table, resolves each
// line to its dish name + price, and opens ONE final bill. It then marks those
// orders billed (so they can't be billed twice) and moves the table to 'billing'.
//
// Cross-context orchestration only — no business rules of its own. It composes
// ordering + catalog + billing + floor use cases.
import { ok, err, NotFoundError } from '#core';

function tableNumber(tableId) {
  const digits = String(tableId ?? '').replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : null;
}

/**
 * @param {object} args
 * @param {object} args.useCases  { ordering, catalog, billing, floor }
 * @param {{tenantId:string}} args.tenant
 * @param {string|number} args.table  the table identifier the guest is seated at
 * @returns Result<{ bill, totals, orderCount }>
 */
export async function openTableBill({ useCases, tenant, table }) {
  const { ordering, catalog, billing, floor } = useCases;

  const r = await ordering.listForTable(tenant, table, { includeBilled: false });
  if (!r.ok) return r;
  const orders = r.value;
  if (orders.length === 0) {
    return err(new NotFoundError(`No open orders to bill for table ${table}`));
  }

  // Flatten every order's lines into per-unit bill lines, resolving each item's
  // dish name AND menu category (Appetizers/Mains/Breads/Drinks) from the catalog
  // — orders may carry only a menuItemId.
  const lines = [];
  for (const o of orders) {
    for (const ln of o.lines) {
      let name = ln.name;
      let category = ln.category ?? null;
      if (ln.menuItemId && catalog?.getItem && ((!name || name === ln.menuItemId) || !category)) {
        const ci = await catalog.getItem(tenant, ln.menuItemId);
        if (ci.ok) {
          if (!name || name === ln.menuItemId) name = ci.value.name;
          if (!category) category = ci.value.category || 'Other';
        }
      }
      const priceMinor = ln.unitPrice?.minor ?? ln.unitPriceMinor ?? 0;
      const qty = ln.qty || 1;
      for (let i = 0; i < qty; i++) {
        lines.push({ name: name || 'Item', category: category || 'Other', priceMinor, shared: true });
      }
    }
  }

  // Open the single aggregated bill (orderId references the first order; the bill
  // carries all the lines across the table's orders).
  const rb = await billing.openBill(tenant, { orderId: orders[0].id, table, lines });
  if (!rb.ok) return rb;

  // Mark each contributing order billed so a second "ask for bill" won't re-bill.
  for (const o of orders) await ordering.markBilled(tenant, o.id);

  // The table shows 'billing' on the floor automatically — the floor view derives
  // it from the now-open bill, so there's no status to set here.

  return ok({ ...rb.value, orderCount: orders.length, sections: groupByCategory(rb.value.bill) });
}

// Conventional menu running order; unknown categories fall to the end.
const CATEGORY_ORDER = ['Appetizers', 'Mains', 'Breads', 'Sides', 'Drinks', 'Desserts', 'Other'];

// Group bill lines into priced sections so the printed bill reads by course.
function groupByCategory(bill) {
  const byCat = new Map();
  for (const l of bill.lines) {
    const cat = l.category || 'Other';
    if (!byCat.has(cat)) byCat.set(cat, { category: cat, count: 0, subtotalMinor: 0, items: [] });
    const g = byCat.get(cat);
    g.count += 1;
    g.subtotalMinor += l.price?.minor ?? 0;
    g.items.push({ name: l.name, priceMinor: l.price?.minor ?? 0 });
  }
  return [...byCat.values()].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a.category); const ib = CATEGORY_ORDER.indexOf(b.category);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}
