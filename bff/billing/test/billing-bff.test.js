import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeededBillingBff } from '../src/build.js';

let server, base, demoBill;
before(async () => {
  ({ server, demoBill } = await buildSeededBillingBff('acme'));
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
  const res = await fetch(`${base}/bills/${demoBill.id}`);
  assert.equal(res.status, 401);
});

test('POST /bills opens a bill then GET returns it', async () => {
  const open = await fetch(`${base}/bills`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      orderId: 'o-100', table: 'Table 7',
      lines: [
        { name: 'Garlic Naan', priceMinor: 6000, participantId: 'a' },
        { name: 'Mango Lassi', priceMinor: 12000, participantId: 'b' },
      ],
    }),
  });
  assert.equal(open.status, 201);
  const created = await open.json();
  assert.equal(created.bill.status, 'open');
  // subtotal 18000 + 5% GST = 18900
  assert.equal(created.totals.total.minor, 18900);

  const get = await fetch(`${base}/bills/${created.bill.id}`, { headers: H });
  assert.equal(get.status, 200);
  const got = await get.json();
  assert.equal(got.bill.id, created.bill.id);
  assert.equal(got.bill.orderId, 'o-100');
});

test('GET /bills/:id/split?mode=by_item returns per-participant amounts', async () => {
  const res = await fetch(`${base}/bills/${demoBill.id}/split?mode=by_item`, { headers: H });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, 'by_item');
  // seeded demo bill has two participants g1, g2
  const ids = Object.keys(body.split);
  assert.deepEqual(ids.sort(), ['g1', 'g2']);
  // each share is a Money value object with positive minor units
  for (const id of ids) {
    assert.ok(body.split[id].minor > 0);
  }
});

test('POST /bills/:id/payments covering the total marks it paid', async () => {
  // Open a fresh bill: subtotal 50000 + 5% GST = 52500
  const open = await fetch(`${base}/bills`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      orderId: 'o-pay', table: 'Table 9',
      lines: [{ name: 'Butter Chicken', priceMinor: 50000 }],
    }),
  });
  const { bill } = await open.json();

  const pay = await fetch(`${base}/bills/${bill.id}/payments`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ method: 'card', amountMinor: 52500 }),
  });
  assert.equal(pay.status, 201);
  const paid = await pay.json();
  assert.equal(paid.paid, true);
  assert.equal(paid.bill.status, 'paid');
});

test('POST /quote with WELCOME20 on 40000 → discountMinor 8000', async () => {
  const res = await fetch(`${base}/quote`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ subtotalMinor: 40000, couponCode: 'WELCOME20' }),
  });
  assert.equal(res.status, 200);
  const q = await res.json();
  assert.equal(q.discountMinor, 8000);
  assert.deepEqual(q.applied, ['coupon:WELCOME20']);
});
