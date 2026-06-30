// Open-tabs read-model: every occupied table the moment its first order lands.
// This is the billing agent's live board — they track a table from the first
// order, watch the running total grow, and generate/settle on demand (not only
// when the guest asks). Pure function over orders + open bills + bill requests.

const key = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return d || String(v ?? ''); };
const lineMinor = (l) => (l.unitPrice?.minor ?? l.unitPriceMinor ?? 0) * (l.qty || 1);

/**
 * @param {object[]} orders  all orders for the tenant
 * @param {object[]} openBills  billing.listOpen() values: [{ bill, totals }]
 * @param {{table:number}[]} billRequests  open 'bill' service requests (table numbers)
 * @returns array of tabs sorted by table number
 */
export function buildOpenTabs(orders = [], openBills = [], billRequests = []) {
  const tabs = new Map(); // tableNum -> tab

  const ensure = (n) => {
    if (!tabs.has(n)) tabs.set(n, { table: n, orderCount: 0, itemCount: 0, runningMinor: 0, asked: false, billId: null, billTotalMinor: 0 });
    return tabs.get(n);
  };

  // Unbilled orders define the running tab.
  for (const o of orders) {
    if (o.billed) continue;
    const n = Number(key(o.tableId));
    if (!n) continue;
    const t = ensure(n);
    t.orderCount += 1;
    for (const l of o.lines || []) { t.itemCount += (l.qty || 1); t.runningMinor += lineMinor(l); }
  }

  // Tables with an already-generated (open) bill — show its total, mark ready.
  for (const b of openBills) {
    const n = Number(key(b?.bill?.table));
    if (!n) continue;
    const t = ensure(n);
    t.billId = b.bill.id;
    t.billTotalMinor = b?.totals?.total?.minor ?? 0;
  }

  // Tables that asked for the bill.
  for (const r of billRequests) {
    const n = Number(key(r.table));
    if (!n) continue;
    ensure(n).asked = true;
  }

  return [...tabs.values()]
    .map((t) => ({ ...t, status: t.billId ? 'bill_ready' : t.asked ? 'asked' : 'open' }))
    .sort((a, b) => a.table - b.table);
}
