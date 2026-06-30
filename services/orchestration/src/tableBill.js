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

  // Flatten every order's lines into per-unit bill lines, resolving dish names
  // (orders may carry only a menuItemId) and prices from the order/catalog.
  const lines = [];
  for (const o of orders) {
    for (const ln of o.lines) {
      let name = ln.name;
      if ((!name || name === ln.menuItemId) && ln.menuItemId && catalog?.getItem) {
        const ci = await catalog.getItem(tenant, ln.menuItemId);
        if (ci.ok) name = ci.value.name;
      }
      const priceMinor = ln.unitPrice?.minor ?? ln.unitPriceMinor ?? 0;
      const qty = ln.qty || 1;
      for (let i = 0; i < qty; i++) lines.push({ name: name || 'Item', priceMinor, shared: true });
    }
  }

  // Open the single aggregated bill (orderId references the first order; the bill
  // carries all the lines across the table's orders).
  const rb = await billing.openBill(tenant, { orderId: orders[0].id, table, lines });
  if (!rb.ok) return rb;

  // Mark each contributing order billed so a second "ask for bill" won't re-bill.
  for (const o of orders) await ordering.markBilled(tenant, o.id);

  // Move the table into 'billing' on the floor.
  const n = tableNumber(table);
  if (n != null && floor?.setTableStatus) {
    await floor.setTableStatus(tenant, { n, status: 'billing' });
  }

  return ok({ ...rb.value, orderCount: orders.length });
}
