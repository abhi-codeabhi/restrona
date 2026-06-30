import { createClient, BASES } from '../../lib/api';
import { minorOf } from '../../lib/format';

// Billing agent client over the unified API. The agent settles a TABLE: every
// unbilled order is aggregated into one categorized final bill, then paid.
const c = createClient(BASES.billing);

export const billingApi = {
  // GET /bills -> open (unpaid) bills with totals.
  getOpenBills: () => c.get('/bills'),
  // GET /requests -> service requests; we surface the 'bill' asks.
  getRequests: () => c.get('/requests'),
  // GET /tables/orders?table=T6 -> running (unbilled) orders for a table.
  getTableOrders: (table: string | number) =>
    c.get('/tables/orders?table=' + encodeURIComponent(String(table))),
  // POST /bills/open-for-table { table } -> one aggregated bill { bill, totals, sections }.
  openTableBill: (table: string | number) => c.post('/bills/open-for-table', { table }),
  // POST /quote { subtotalMinor, couponCode } -> { discountMinor, applied }.
  quote: (subtotalMinor: number, couponCode: string) => c.post('/quote', { subtotalMinor, couponCode }),
  // POST /bills/:id/discount { minor, reason }.
  applyDiscount: (billId: string, minor: number, reason: string) =>
    c.post('/bills/' + encodeURIComponent(billId) + '/discount', { minor, reason }),
  // POST /bills/:id/payments { method, amountMinor } -> { bill, totals, paid }.
  pay: (billId: string, method: string, amountMinor: number) =>
    c.post('/bills/' + encodeURIComponent(billId) + '/payments', { method, amountMinor }),
  // POST /requests/:id/ack -> clear a 'bill' request once handled.
  ackRequest: (id: string) => c.post('/requests/' + encodeURIComponent(id) + '/ack', { now: Date.now() }),
};

const tableNum = (v: any) => Number(String(v ?? '').replace(/\D/g, '')) || 0;

export type OpenBill = {
  id: string;
  table: number;
  totalMinor: number;
  lines: { name: string; category: string; priceMinor: number }[];
};

export function normalizeOpenBills(res: any): OpenBill[] {
  const raw = Array.isArray(res) ? res : res?.value ?? [];
  return (raw || [])
    .map((b: any) => ({
      id: b?.bill?.id,
      table: tableNum(b?.bill?.table),
      totalMinor: minorOf(b?.totals?.total),
      lines: (b?.bill?.lines ?? []).map((l: any) => ({
        name: l.name, category: l.category ?? 'Other', priceMinor: minorOf(l.price),
      })),
    }))
    .filter((b: OpenBill) => b.id);
}

// 'bill' service requests = tables that asked to settle.
export function normalizeBillRequests(res: any): { id: string; table: number }[] {
  const raw = Array.isArray(res) ? res : res?.value ?? res?.requests ?? [];
  return (raw || [])
    .filter((r: any) => (r.type ?? '') === 'bill' && r.state !== 'done')
    .map((r: any) => ({ id: r.id, table: tableNum(r.table) }))
    .filter((r: any) => r.id);
}

export type RunningOrder = { id: string; lines: { name: string; qty: number; priceMinor: number }[] };

export function normalizeTableOrders(res: any): RunningOrder[] {
  const raw = Array.isArray(res) ? res : res?.value ?? [];
  return (raw || []).map((o: any) => ({
    id: o.id,
    lines: (o.lines ?? []).map((l: any) => ({
      name: l.name, qty: l.qty ?? 1, priceMinor: minorOf(l.unitPrice ?? l.unitPriceMinor),
    })),
  }));
}

// Group bill lines into priced sections in conventional menu order.
const ORDER = ['Appetizers', 'Mains', 'Breads', 'Sides', 'Drinks', 'Desserts', 'Other'];
export function sectionsOf(lines: { name: string; category: string; priceMinor: number }[]) {
  const m = new Map<string, { category: string; subtotalMinor: number; items: { name: string; priceMinor: number }[] }>();
  for (const l of lines) {
    const cat = l.category || 'Other';
    if (!m.has(cat)) m.set(cat, { category: cat, subtotalMinor: 0, items: [] });
    const g = m.get(cat)!;
    g.subtotalMinor += l.priceMinor;
    g.items.push({ name: l.name, priceMinor: l.priceMinor });
  }
  return [...m.values()].sort((a, b) => {
    const ia = ORDER.indexOf(a.category), ib = ORDER.indexOf(b.category);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}
