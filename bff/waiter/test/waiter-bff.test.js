import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeededWaiterBff } from '../src/build.js';

let server, base;
before(async () => {
  ({ server } = await buildSeededWaiterBff('acme'));
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
  const res = await fetch(`${base}/floor`);
  assert.equal(res.status, 401);
});

test('GET /floor returns the seeded tables', async () => {
  const res = await fetch(`${base}/floor`, { headers: H });
  assert.equal(res.status, 200);
  const floor = await res.json();
  const numbers = floor.tables.map((t) => t.n).sort((a, b) => a - b);
  assert.deepEqual(numbers, [3, 5, 7, 8, 9, 12]);
  // table 12 was seeded as seated with a waiter + order
  const t12 = floor.tables.find((t) => t.n === 12);
  assert.equal(t12.status, 'seated');
  assert.equal(t12.order, 'ord_demo_1');
});

test('POST /tables/move to a FREE table succeeds (carries the order)', async () => {
  // table 12 is seated (ord_demo_1), table 3 is free -> MOVE
  const res = await fetch(`${base}/tables/move`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ srcN: 12, dstN: 3 }),
  });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.verb, 'moved');
  const t3 = out.floor.tables.find((t) => t.n === 3);
  assert.equal(t3.order, 'ord_demo_1');
  assert.equal(t3.status, 'seated');
  const t12 = out.floor.tables.find((t) => t.n === 12);
  assert.equal(t12.status, 'free');
  assert.equal(t12.order, null);
});

test('POST /orders returns 201 (waiter taking an order)', async () => {
  const res = await fetch(`${base}/orders`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ tableId: 'T7', items: [{ menuItemId: 'paneer', unitPriceMinor: 24000, qty: 2 }] }),
  });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.order.status, 'PENDING');
});

test('GET /requests returns open service requests (empty initially)', async () => {
  const res = await fetch(`${base}/requests`, { headers: H });
  assert.equal(res.status, 200);
  const open = await res.json();
  assert.ok(Array.isArray(open));
});

test('POST /tables/assign assigns a waiter to a table', async () => {
  const res = await fetch(`${base}/tables/assign`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ n: 9, waiterId: 'w_geeta' }),
  });
  assert.equal(res.status, 200);
  const floor = await res.json();
  const t9 = floor.tables.find((t) => t.n === 9);
  assert.equal(t9.waiterId, 'w_geeta');
});
