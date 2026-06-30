// End-to-end saga test: prove an order travels across surfaces in ONE shared API.
// customer places order -> kitchen board shows a ticket -> floor table is 'cooking'
// -> kitchen bumps the ticket -> floor goes 'ready' -> a bill is opened.
// Runs entirely in-memory (no network, no Postgres) via the use cases the HTTP
// routes call, so it isolates the saga wiring from transport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApiApp, seedDemoData } from '../src/build.js';

const TENANT = { tenantId: 'acme', tier: 'T1_POOLED', region: 'ap-mumbai-1' };

// The HTTP layer relays the outbox after each command; replicate that here so the
// saga fires exactly as it would in the running server.
async function drain(outbox, bus) {
  let n; do { n = await outbox.relayTo(bus); } while (n > 0);
}

test('order placed by customer flows to kitchen, floor and billing', async () => {
  const app = buildApiApp();
  await seedDemoData(app.useCases, 'acme');
  const { useCases: uc, outbox, bus } = app;
  await drain(outbox, bus); // flush seed events

  // Look up two real menu items to order.
  const menu = (await uc.catalog.getMenu(TENANT)).value;
  const butter = menu.find((i) => i.name === 'Butter Chicken');
  const naan = menu.find((i) => i.name === 'Garlic Naan');
  assert.ok(butter && naan, 'seeded menu present');

  // 1) Customer places an order at table 5.
  const placed = await uc.ordering.placeOrder(TENANT, {
    tableId: 'T5',
    items: [
      { menuItemId: butter.id, unitPriceMinor: butter.price.minor, qty: 1 },
      { menuItemId: naan.id, unitPriceMinor: naan.price.minor, qty: 2 },
    ],
  });
  assert.ok(placed.ok, 'order placed');
  const orderId = placed.value.order.id;
  await drain(outbox, bus); // saga: OrderPlaced -> kitchen ticket + floor cooking

  // 2) Kitchen board now has a ticket for this order with 3 item-units.
  const board = (await uc.kitchen.getBoard(TENANT)).value;
  const ticket = board.find((t) => t.orderId === orderId);
  assert.ok(ticket, 'kitchen ticket created by saga');
  assert.equal(ticket.items.length, 3, '1 butter + 2 naan = 3 units');
  assert.equal(ticket.table, 'T5');

  // 3) Floor: table 5 is seated + cooking, carrying this order.
  const floor1 = (await uc.floor.getFloor(TENANT)).value;
  const t5 = floor1.tables.find((t) => t.n === 5);
  assert.equal(t5.status, 'cooking', 'waiter floor shows table cooking');
  assert.equal(t5.order, orderId);

  // 4) Kitchen bumps the whole ticket to ready.
  const bumped = await uc.kitchen.markAllReady(TENANT, { ticketId: ticket.id });
  assert.ok(bumped.ok);
  await drain(outbox, bus); // saga: TicketReady -> floor ready + open bill

  // 5) Floor: table 5 now 'ready' (waiter's serve feed).
  const floor2 = (await uc.floor.getFloor(TENANT)).value;
  assert.equal(floor2.tables.find((t) => t.n === 5).status, 'ready', 'table ready to serve');

  // 6) Billing: a bill was opened for this order with all 3 units.
  const open = (await uc.billing.listOpen(TENANT)).value;
  const bill = open.find((b) => b.bill.orderId === orderId);
  assert.ok(bill, 'bill opened by saga');
  assert.equal(bill.bill.lines.length, 3, 'bill has every unit');
  assert.ok(bill.totals.total.minor > 0, 'bill has a positive total');
});

test('order with an unknown table still reaches the kitchen (floor best-effort)', async () => {
  const app = buildApiApp();
  await seedDemoData(app.useCases, 'acme');
  const { useCases: uc, outbox, bus } = app;
  await drain(outbox, bus);

  const menu = (await uc.catalog.getMenu(TENANT)).value;
  const lassi = menu.find((i) => i.name === 'Mango Lassi');

  const placed = await uc.ordering.placeOrder(TENANT, {
    tableId: 'PATIO', // no numeric table -> floor seat skipped, kitchen still fires
    items: [{ menuItemId: lassi.id, unitPriceMinor: lassi.price.minor, qty: 1 }],
  });
  assert.ok(placed.ok);
  await drain(outbox, bus);

  const board = (await uc.kitchen.getBoard(TENANT)).value;
  assert.ok(board.find((t) => t.orderId === placed.value.order.id), 'ticket fired even without a numeric table');
});
