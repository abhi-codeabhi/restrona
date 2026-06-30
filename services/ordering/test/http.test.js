import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/main.js';

let server, base;
before(async () => {
  ({ server } = buildApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const H = { 'content-type': 'application/json', 'x-tenant-id': 'acme' };

test('GET /healthz is open', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
});

test('POST /orders without tenant header → 401', async () => {
  const res = await fetch(`${base}/orders`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 401);
});

test('POST /orders invalid body → 422', async () => {
  const res = await fetch(`${base}/orders`, { method: 'POST', headers: H, body: JSON.stringify({ items: [] }) });
  assert.equal(res.status, 422);
  const j = await res.json();
  assert.equal(j.code, 'VALIDATION');
});

test('POST /orders then GET /orders/:id', async () => {
  const create = await fetch(`${base}/orders`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ tableId: 'T12', items: [{ menuItemId: 'paneer', unitPriceMinor: 24000, qty: 1 }] }),
  });
  assert.equal(create.status, 201);
  const created = await create.json();
  assert.equal(created.order.status, 'PENDING');
  assert.equal(created.totals.total.minor, 25200);

  const get = await fetch(`${base}/orders/${created.order.id}`, { headers: H });
  assert.equal(get.status, 200);
  const got = await get.json();
  assert.equal(got.order.id, created.order.id);

  // cross-tenant read is a miss
  const other = await fetch(`${base}/orders/${created.order.id}`, { headers: { ...H, 'x-tenant-id': 'globex' } });
  assert.equal(other.status, 404);
});
