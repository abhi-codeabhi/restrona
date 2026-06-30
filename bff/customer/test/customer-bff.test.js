import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeededCustomerBff } from '../src/build.js';

let server, base;
before(async () => {
  ({ server } = await buildSeededCustomerBff('acme'));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const H = { 'content-type': 'application/json', 'x-tenant-id': 'acme' };

test('GET /healthz is open (no tenant required)', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
});

test('missing x-tenant-id → 401', async () => {
  const res = await fetch(`${base}/menu`);
  assert.equal(res.status, 401);
});

test('GET /menu returns the seeded items', async () => {
  const res = await fetch(`${base}/menu`, { headers: H });
  assert.equal(res.status, 200);
  const items = await res.json();
  assert.equal(items.length, 4);
  const names = items.map((i) => i.name).sort();
  assert.deepEqual(names, ['Butter Chicken', 'Garlic Naan', 'Mango Lassi', 'Paneer Tikka Bowl']);
});

test('GET /menu?prefs=vegan flags dairy items as not suitable with a reason', async () => {
  const res = await fetch(`${base}/menu?prefs=vegan`, { headers: H });
  assert.equal(res.status, 200);
  const rows = await res.json();
  // every row is { item, suitable, reasons }
  for (const row of rows) {
    assert.ok('item' in row && 'suitable' in row && Array.isArray(row.reasons));
  }
  const lassi = rows.find((r) => r.item.name === 'Mango Lassi');
  assert.equal(lassi.suitable, false);
  assert.ok(lassi.reasons.some((m) => m.toLowerCase().includes('dairy')));
  // Butter Chicken contains meat → also not vegan-suitable.
  const chicken = rows.find((r) => r.item.name === 'Butter Chicken');
  assert.equal(chicken.suitable, false);
});

test('POST /orders returns 201 with PENDING + correct total', async () => {
  const res = await fetch(`${base}/orders`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ tableId: 'T12', items: [{ menuItemId: 'paneer', unitPriceMinor: 24000, qty: 1 }] }),
  });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.order.status, 'PENDING');
  // subtotal 24000 + 5% GST = 25200
  assert.equal(created.totals.total.minor, 25200);

  const get = await fetch(`${base}/orders/${created.order.id}`, { headers: H });
  assert.equal(get.status, 200);
  const got = await get.json();
  assert.equal(got.order.id, created.order.id);
});

test('POST /checkout/quote with WELCOME20 on 40000 subtotal → discount 8000, total 32000', async () => {
  const res = await fetch(`${base}/checkout/quote`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ subtotalMinor: 40000, couponCode: 'WELCOME20' }),
  });
  assert.equal(res.status, 200);
  const q = await res.json();
  assert.equal(q.subtotalMinor, 40000);
  assert.equal(q.discountMinor, 8000);
  assert.equal(q.totalMinor, 32000);
  assert.deepEqual(q.applied, ['coupon:WELCOME20']);
});

test('POST /service-requests returns success', async () => {
  const res = await fetch(`${base}/service-requests`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ type: 'water', table: 'T12' }),
  });
  assert.equal(res.status, 200);
  const req = await res.json();
  assert.equal(req.type, 'water');
  assert.equal(req.table, 'T12');
});

test('shared-table session: open, add item, split', async () => {
  const open = await fetch(`${base}/sessions`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ tableId: 'T20', participants: [{ id: 'p1' }, { id: 'p2' }] }),
  });
  assert.equal(open.status, 201);
  const session = await open.json();

  const add = await fetch(`${base}/sessions/${session.id}/items`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: 'Garlic Naan', priceMinor: 6000, shared: true }),
  });
  assert.equal(add.status, 200);

  const split = await fetch(`${base}/sessions/${session.id}/split`, { headers: H });
  assert.equal(split.status, 200);
});
