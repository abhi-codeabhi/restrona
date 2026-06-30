// Full-journey HTTP integration sweep. Boots the REAL unified API on an ephemeral
// port and drives every surface over HTTP (the same path the deployed app uses),
// so it catches transport/wiring bugs — routing, headers, response shapes,
// table-id matching — that pure use-case tests miss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeededApi } from '../src/build.js';

async function startApi() {
  const { server } = await buildSeededApi('acme');
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const H = { 'content-type': 'application/json', 'x-tenant-id': 'acme' };
  const j = async (res) => ({ status: res.status, body: res.status === 204 ? null : await res.json() });
  return {
    get: (p) => fetch(base + p, { headers: H }).then(j),
    post: (p, b) => fetch(base + p, { method: 'POST', headers: H, body: b ? JSON.stringify(b) : undefined }).then(j),
    raw: (p, opts) => fetch(base + p, opts),
    close: () => new Promise((r) => server.close(r)),
  };
}
const menuItem = (menu, name) => menu.find((i) => i.name === name);
async function order(api, table, picks) {
  const menu = (await api.get('/menu')).body;
  const items = picks.map(([name, qty]) => {
    const it = menuItem(menu, name);
    return { menuItemId: it.id, unitPriceMinor: it.price.minor, qty };
  });
  return (await api.post('/orders', { tableId: table, items })).body;
}

test('health + tenant guard', async () => {
  const api = await startApi();
  try {
    assert.equal((await api.get('/healthz')).status, 200);
    // Missing x-tenant-id -> 401.
    const r = await api.raw('/menu', {});
    assert.equal(r.status, 401);
  } finally { await api.close(); }
});

test('customer: menu is categorized and ordering returns a created order', async () => {
  const api = await startApi();
  try {
    const menu = (await api.get('/menu')).body;
    assert.equal(menu.length, 5);
    assert.deepEqual([...new Set(menu.map((i) => i.category))].sort(), ['Appetizers', 'Breads', 'Drinks', 'Mains']);
    const placed = await order(api, 'T5', [['Butter Chicken', 1], ['Garlic Naan', 2]]);
    assert.ok(placed.order.id);
    assert.equal(placed.order.lines.length, 2);
  } finally { await api.close(); }
});

test('kitchen + waiter: cook, bump to serve queue, serve clears it; floor derived', async () => {
  const api = await startApi();
  try {
    const o = await order(api, 'T5', [['Butter Chicken', 1], ['Garlic Naan', 2]]);
    const tk = (await api.get('/board')).body.find((t) => t.orderId === o.order.id);
    assert.ok(tk, 'ticket on board');
    assert.equal(tk.items.length, 3, '1 + 2 units');
    assert.equal((await api.get('/floor')).body.tables.find((t) => t.n === 5).status, 'cooking');

    // advance one item then bump the rest
    assert.equal((await api.post(`/tickets/${tk.id}/advance`, { itemIndex: 0 })).status, 200);
    await api.post(`/tickets/${tk.id}/bump`);
    assert.ok(!(await api.get('/board')).body.find((t) => t.id === tk.id), 'off cook board');
    const q = (await api.get('/serve-queue')).body;
    assert.equal(q.length, 1);
    assert.equal(q[0].ticketId, tk.id);
    assert.equal((await api.get('/floor')).body.tables.find((t) => t.n === 5).status, 'ready');

    await api.post(`/tickets/${tk.id}/serve`);
    assert.equal((await api.get('/serve-queue')).body.length, 0, 'served, queue empty');
    assert.equal((await api.get('/floor')).body.tables.find((t) => t.n === 5).status, 'seated');
  } finally { await api.close(); }
});

test('multi-order: serving order 1 leaves order 2 cooking (per-ticket)', async () => {
  const api = await startApi();
  try {
    const o1 = await order(api, 'T6', [['Butter Chicken', 1]]);
    const o2 = await order(api, 'T6', [['Garlic Naan', 2], ['Mango Lassi', 1]]);
    const t1 = (await api.get('/board')).body.find((t) => t.orderId === o1.order.id);
    const t2 = (await api.get('/board')).body.find((t) => t.orderId === o2.order.id);
    await api.post(`/tickets/${t1.id}/bump`);
    let q = (await api.get('/serve-queue')).body;
    assert.equal(q.length, 1, 'only order 1 ready');
    await api.post(`/tickets/${t1.id}/serve`);
    assert.equal((await api.get('/serve-queue')).body.length, 0);
    const t2After = (await api.get('/board')).body.find((t) => t.id === t2.id);
    assert.ok(t2After && t2After.served === false, 'order 2 untouched, still cooking');
    assert.equal((await api.get('/floor')).body.tables.find((t) => t.n === 6).status, 'cooking');
  } finally { await api.close(); }
});

test('service requests: raise -> open list -> escalate -> ack', async () => {
  const api = await startApi();
  try {
    assert.equal((await api.post('/service-requests', { type: 'call', table: 7 })).status, 200);
    let open = (await api.get('/requests')).body;
    const r = open.find((x) => x.table === 7 && x.type === 'call');
    assert.ok(r, 'request listed open');
    // escalate with a far-future clock -> request becomes escalated
    await api.post('/requests/escalate', { now: Date.now() + 10 * 60 * 1000 });
    assert.ok((await api.get('/requests')).body.find((x) => x.id === r.id && x.state === 'escalated'), 'escalated');
    // acknowledge clears it from the open list
    assert.equal((await api.post(`/requests/${r.id}/ack`, { now: Date.now() })).status, 200);
    assert.ok(!(await api.get('/requests')).body.find((x) => x.id === r.id), 'acked, off open list');
  } finally { await api.close(); }
});

test('billing: ask -> generate (tolerant table) -> categorized -> pay -> clears', async () => {
  const api = await startApi();
  try {
    await order(api, 'T8', [['Butter Chicken', 1]]);
    await order(api, 'T8', [['Garlic Naan', 2], ['Mango Lassi', 1]]);
    await api.post('/service-requests', { type: 'bill', table: 8 });

    // preview running orders by numeric table (the surface uses numeric)
    const preview = (await api.get('/tables/orders?table=8')).body;
    assert.equal(preview.length, 2, 'tolerant table match');
    assert.ok(preview.some((o) => o.lines.some((l) => l.name === 'Butter Chicken')), 'preview shows dish names, not ids');

    const gen = (await api.post('/bills/open-for-table', { table: 8 })).body;
    assert.equal(gen.orderCount, 2);
    assert.equal(gen.bill.lines.length, 4, '1 + 3 dishes');
    assert.deepEqual(gen.sections.map((s) => s.category), ['Mains', 'Breads', 'Drinks']);
    assert.ok(gen.totals.total.minor > 0);
    assert.equal((await api.get('/bills')).body.length, 1, 'open bill listed');

    const pay = (await api.post(`/bills/${gen.bill.id}/payments`, { method: 'upi', amountMinor: gen.totals.total.minor })).body;
    assert.equal(pay.paid, true);
    assert.equal((await api.get('/bills')).body.length, 0, 'bill settled, off the queue');

    // re-billing the same table finds nothing
    assert.equal((await api.post('/bills/open-for-table', { table: 8 })).status, 404);
  } finally { await api.close(); }
});

test('billing board: tracks every table from its first order', async () => {
  const api = await startApi();
  try {
    // No orders yet -> empty board.
    assert.equal((await api.get('/open-tabs')).body.length, 0);

    await order(api, 'T4', [['Butter Chicken', 1]]);          // table 4 opens
    await order(api, 'T4', [['Garlic Naan', 2]]);             // second round, same table
    await order(api, 'T6', [['Mango Lassi', 1]]);             // table 6 opens

    const tabs = (await api.get('/open-tabs')).body;
    assert.equal(tabs.length, 2, 'two occupied tables tracked from first order');
    const t4 = tabs.find((t) => t.table === 4);
    assert.equal(t4.orderCount, 2);
    assert.equal(t4.itemCount, 3);
    assert.equal(t4.runningMinor, 34000 + 2 * 6000, 'running total from first order');
    assert.equal(t4.status, 'open');

    // Generate the bill for table 4 -> it flips to bill_ready with a bill id.
    await api.post('/bills/open-for-table', { table: 4 });
    const after = (await api.get('/open-tabs')).body.find((t) => t.table === 4);
    assert.equal(after.status, 'bill_ready');
    assert.ok(after.billId);
  } finally { await api.close(); }
});

test('billing: coupon quote + discount lowers the total', async () => {
  const api = await startApi();
  try {
    await order(api, 'T3', [['Butter Chicken', 1]]); // 34000 > 30000 min
    const gen = (await api.post('/bills/open-for-table', { table: 3 })).body;
    const before = gen.totals.total.minor;
    const quote = (await api.post('/quote', { subtotalMinor: 34000, couponCode: 'WELCOME20' })).body;
    assert.ok(quote.discountMinor > 0, 'WELCOME20 grants a discount');
    const disc = (await api.post(`/bills/${gen.bill.id}/discount`, { minor: quote.discountMinor, reason: 'WELCOME20' })).body;
    assert.ok(disc.totals.total.minor < before, 'total dropped after discount');
  } finally { await api.close(); }
});

test('kitchen 86: pulling an item removes it from the customer menu', async () => {
  const api = await startApi();
  try {
    const menu = (await api.get('/menu')).body;
    const lassi = menuItem(menu, 'Mango Lassi');
    assert.equal((await api.post('/menu/86', { itemId: lassi.id, available: false })).status, 200);
    assert.ok(!(await api.get('/menu')).body.find((i) => i.id === lassi.id), '86d item hidden');
  } finally { await api.close(); }
});

test('floor: move a seated table to a free one', async () => {
  const api = await startApi();
  try {
    await order(api, 'T2', [['Veg Biryani', 1]]); // seats table 2
    const moved = (await api.post('/tables/move', { srcN: 2, dstN: 1 })).body;
    assert.ok(moved.verb === 'moved' || moved.floor, 'move ok');
    const floor = (await api.get('/floor')).body;
    assert.equal(floor.tables.find((t) => t.n === 1).status, 'cooking', 'order moved to table 1');
  } finally { await api.close(); }
});

test('manager: staff roster — list seeded, add, disable', async () => {
  const api = await startApi();
  try {
    const seeded = (await api.get('/admin/staff')).body;
    assert.ok(seeded.length >= 3, 'seeded team present');
    const added = (await api.post('/admin/staff', { name: 'Meera', role: 'waiter' })).body;
    assert.equal(added.role, 'waiter');
    assert.ok((await api.get('/admin/staff')).body.find((s) => s.id === added.id));
    await api.post(`/admin/staff/${added.id}/disable`);
    assert.equal((await api.get('/admin/staff')).body.find((s) => s.id === added.id).disabled, true);
  } finally { await api.close(); }
});

test('manager: assign MANY tables to one waiter in a single action', async () => {
  const api = await startApi();
  try {
    const w = (await api.post('/admin/staff', { name: 'Kabir', role: 'waiter' })).body;
    await api.post('/admin/tables/assign', { ns: [1, 2, 3], waiterId: w.id });
    const floor = (await api.get('/floor')).body.tables;
    assert.deepEqual([1, 2, 3].map((n) => floor.find((t) => t.n === n).waiterId), [w.id, w.id, w.id]);
    // reassign table 2 to someone else
    const w2 = (await api.post('/admin/staff', { name: 'Lina', role: 'waiter' })).body;
    await api.post('/admin/tables/assign', { n: 2, waiterId: w2.id });
    assert.equal((await api.get('/floor')).body.tables.find((t) => t.n === 2).waiterId, w2.id);
  } finally { await api.close(); }
});

test('manager: enable/disable a menu item reflects on the customer menu', async () => {
  const api = await startApi();
  try {
    const all = (await api.get('/menu/all')).body;
    assert.equal(all.length, 5);
    const naan = all.find((i) => i.name === 'Garlic Naan');
    await api.post('/menu/86', { itemId: naan.id, available: false });
    assert.equal((await api.get('/menu/all')).body.find((i) => i.id === naan.id).available, false, 'still in manager view');
    assert.ok(!(await api.get('/menu')).body.find((i) => i.id === naan.id), 'hidden from customer');
    await api.post('/menu/86', { itemId: naan.id, available: true });
    assert.ok((await api.get('/menu')).body.find((i) => i.id === naan.id), 'back on the menu');
  } finally { await api.close(); }
});

test('manager: nudge config get defaults + save changes', async () => {
  const api = await startApi();
  try {
    const cfg = (await api.get('/admin/nudge-config')).body;
    assert.equal(cfg.greet.enabled, true);
    assert.equal(cfg.checkin.afterServeSecs, 300);
    const saved = (await api.post('/admin/nudge-config', { config: { greet: { delaySecs: 60 }, checkin: { enabled: false } } })).body;
    assert.equal(saved.greet.delaySecs, 60);
    assert.equal(saved.checkin.enabled, false);
    assert.equal((await api.get('/admin/nudge-config')).body.greet.delaySecs, 60, 'persisted');
  } finally { await api.close(); }
});

test('waiter: seat a party arms the greet timer; nudges endpoint responds', async () => {
  const api = await startApi();
  try {
    await api.post('/tables/seat', { n: 2 });
    const t2 = (await api.get('/floor')).body.tables.find((t) => t.n === 2);
    assert.equal(t2.status, 'seated');
    assert.equal(typeof t2.seatedAt, 'number', 'greet timer armed');
    // greet delay (30s) hasn't elapsed, so nothing is due yet — but the endpoint works.
    assert.ok(Array.isArray((await api.get('/nudges')).body));
  } finally { await api.close(); }
});

test('owner: dashboard + menu-engineering respond with data', async () => {
  const api = await startApi();
  try {
    const dash = (await api.get('/owner/dashboard')).body;
    assert.ok(dash.covers && Array.isArray(dash.stations));
    const iq = (await api.get('/owner/menu-engineering')).body;
    assert.equal(iq.dishes.length, 5);
    assert.ok(iq.dishes.every((d) => typeof d.profit === 'number' && typeof d.popularity === 'number'));
  } finally { await api.close(); }
});

test('errors: serve a missing ticket -> 404', async () => {
  const api = await startApi();
  try {
    assert.equal((await api.post('/tickets/does-not-exist/serve')).status, 404);
  } finally { await api.close(); }
});
