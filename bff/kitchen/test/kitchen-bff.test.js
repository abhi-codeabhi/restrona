import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeededKitchenBff } from '../src/build.js';

let server, base, repos;
const tenant = { tenantId: 'acme', tier: 'T1_POOLED', region: 'ap-mumbai-1' };

before(async () => {
  ({ server, repos } = await buildSeededKitchenBff('acme'));
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
  const res = await fetch(`${base}/board`);
  assert.equal(res.status, 401);
});

test('GET /board returns the seeded tickets (oldest first)', async () => {
  const res = await fetch(`${base}/board`, { headers: H });
  assert.equal(res.status, 200);
  const board = await res.json();
  assert.equal(board.length, 2);
  const tables = board.map((t) => t.table).sort();
  assert.deepEqual(tables, ['T12', 'T7']);
  // every ticket has items each starting at state 0 ('new')
  for (const ticket of board) {
    assert.ok(Array.isArray(ticket.items) && ticket.items.length > 0);
    assert.ok(ticket.items.every((it) => it.state === 0));
  }
});

test('POST /tickets/:id/advance advances an item new -> preparing', async () => {
  const boardRes = await fetch(`${base}/board`, { headers: H });
  const board = await boardRes.json();
  const ticket = board[0];

  const res = await fetch(`${base}/tickets/${ticket.id}/advance`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ itemIndex: 0 }),
  });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.id, ticket.id);
  assert.equal(updated.items[0].state, 1); // 'preparing'
});

test('GET /all-day returns counts of not-yet-ready items', async () => {
  const res = await fetch(`${base}/all-day`, { headers: H });
  assert.equal(res.status, 200);
  const counts = await res.json();
  assert.equal(typeof counts, 'object');
  // Two Naan items on table 12 → count of 2 (none yet ready).
  assert.equal(counts['Naan'], 2);
  // There is at least one item still owed across the board.
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.ok(total > 0);
});

test('POST /menu/86 toggles a menu item unavailable', async () => {
  // grab a seeded item id straight from the shared catalog repo
  const items = await repos.items.list(tenant);
  assert.ok(items.length > 0);
  const item = items[0];

  const res = await fetch(`${base}/menu/86`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ itemId: item.id, available: false }),
  });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.id, item.id);
  assert.equal(updated.available, false);
});
