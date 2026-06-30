// End-to-end saga tests over the ONE shared API. Customer order -> kitchen ticket
// -> waiter serve queue -> billing. Floor status is DERIVED per table from its
// tickets + open bill (a table runs several orders at once), and serving is
// PER-TICKET (per order). Runs in-memory via the same use cases the HTTP routes
// call, so it isolates the wiring from transport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApiApp, seedDemoData } from '../src/build.js';
import { openTableBill } from '../../../services/orchestration/src/tableBill.js';
import { buildFloorView } from '../../../services/orchestration/src/floorView.js';

const TENANT = { tenantId: 'acme', tier: 'T1_POOLED', region: 'ap-mumbai-1' };

async function drain(outbox, bus) {
  let n; do { n = await outbox.relayTo(bus); } while (n > 0);
}

// Mirror the API's GET /floor read-model: stored floor + live tickets + open bills.
async function floorView(uc) {
  const fr = (await uc.floor.getFloor(TENANT)).value;
  const cooking = (await uc.kitchen.getBoard(TENANT)).value || [];
  const ready = (await uc.kitchen.readyQueue(TENANT)).value || [];
  const bills = (await uc.billing.listOpen(TENANT)).value || [];
  return buildFloorView(fr, [...cooking, ...ready], bills);
}
const statusOf = (view, n) => view.tables.find((t) => t.n === n)?.status;

test('order -> kitchen -> serve queue -> serve; floor status derived throughout', async () => {
  const app = buildApiApp();
  await seedDemoData(app.useCases, 'acme');
  const { useCases: uc, outbox, bus } = app;
  await drain(outbox, bus);

  const menu = (await uc.catalog.getMenu(TENANT)).value;
  const butter = menu.find((i) => i.name === 'Butter Chicken');
  const naan = menu.find((i) => i.name === 'Garlic Naan');

  const placed = await uc.ordering.placeOrder(TENANT, {
    tableId: 'T5',
    items: [
      { menuItemId: butter.id, unitPriceMinor: butter.price.minor, qty: 1 },
      { menuItemId: naan.id, unitPriceMinor: naan.price.minor, qty: 2 },
    ],
  });
  assert.ok(placed.ok);
  const orderId = placed.value.order.id;
  await drain(outbox, bus);

  // Kitchen board has the cooking ticket; floor derives 'cooking'.
  const ticket = (await uc.kitchen.getBoard(TENANT)).value.find((t) => t.orderId === orderId);
  assert.ok(ticket, 'kitchen ticket created');
  assert.equal(ticket.items.length, 3);
  assert.equal(statusOf(await floorView(uc), 5), 'cooking');

  // Bump -> ticket ready: leaves the cook board, enters the serve queue; floor 'ready'.
  await uc.kitchen.markAllReady(TENANT, { ticketId: ticket.id });
  await drain(outbox, bus);
  assert.ok(!(await uc.kitchen.getBoard(TENANT)).value.find((t) => t.id === ticket.id), 'off cook board');
  assert.ok((await uc.kitchen.readyQueue(TENANT)).value.find((t) => t.id === ticket.id), 'in serve queue');
  assert.equal(statusOf(await floorView(uc), 5), 'ready');

  // Waiter serves THIS ticket -> leaves the queue; floor back to 'seated'.
  await uc.kitchen.serveTicket(TENANT, { ticketId: ticket.id });
  await drain(outbox, bus);
  assert.equal((await uc.kitchen.readyQueue(TENANT)).value.length, 0, 'serve queue empty');
  assert.equal(statusOf(await floorView(uc), 5), 'seated');
  assert.equal((await uc.billing.listOpen(TENANT)).value.length, 0, 'no bill until requested');
});

test('multi-order table: serving the first order does NOT serve the second', async () => {
  const app = buildApiApp();
  await seedDemoData(app.useCases, 'acme');
  const { useCases: uc, outbox, bus } = app;
  await drain(outbox, bus);

  const menu = (await uc.catalog.getMenu(TENANT)).value;
  const pick = (n) => menu.find((i) => i.name === n);
  const butter = pick('Butter Chicken'), naan = pick('Garlic Naan'), lassi = pick('Mango Lassi'), biryani = pick('Veg Biryani');

  // Round 1: one dish at table 6.
  const o1 = await uc.ordering.placeOrder(TENANT, {
    tableId: 'T6', items: [{ menuItemId: butter.id, unitPriceMinor: butter.price.minor, qty: 1 }],
  });
  await drain(outbox, bus);
  // Some time later, round 2: three dishes at the same table.
  const o2 = await uc.ordering.placeOrder(TENANT, {
    tableId: 'T6', items: [
      { menuItemId: naan.id, unitPriceMinor: naan.price.minor, qty: 1 },
      { menuItemId: lassi.id, unitPriceMinor: lassi.price.minor, qty: 1 },
      { menuItemId: biryani.id, unitPriceMinor: biryani.price.minor, qty: 1 },
    ],
  });
  await drain(outbox, bus);

  const t1 = (await uc.kitchen.getBoard(TENANT)).value.find((t) => t.orderId === o1.value.order.id);
  const t2 = (await uc.kitchen.getBoard(TENANT)).value.find((t) => t.orderId === o2.value.order.id);
  assert.ok(t1 && t2, 'both tickets cooking');

  // Order 1: mark preparing then ready (item by item), order 2 left cooking.
  await uc.kitchen.advanceItem(TENANT, { ticketId: t1.id, itemIndex: 0 }); // -> preparing
  await uc.kitchen.advanceItem(TENANT, { ticketId: t1.id, itemIndex: 0 }); // -> ready (all ready)
  await drain(outbox, bus);

  // Serve queue holds ONLY order 1; order 2 still on the cook board.
  let queue = (await uc.kitchen.readyQueue(TENANT)).value;
  assert.equal(queue.length, 1, 'only order 1 ready');
  assert.equal(queue[0].id, t1.id);
  assert.ok((await uc.kitchen.getBoard(TENANT)).value.find((t) => t.id === t2.id), 'order 2 still cooking');
  assert.equal(statusOf(await floorView(uc), 6), 'ready'); // table has a ready ticket

  // Serve order 1.
  await uc.kitchen.serveTicket(TENANT, { ticketId: t1.id });
  await drain(outbox, bus);

  // THE KEY ASSERTION: order 2 was NOT served and is still cooking.
  const t2After = (await uc.kitchen.getBoard(TENANT)).value.find((t) => t.id === t2.id);
  assert.ok(t2After, 'order 2 still on the cook board after serving order 1');
  assert.equal(t2After.served, false, 'order 2 not served');
  assert.equal((await uc.kitchen.readyQueue(TENANT)).value.length, 0, 'nothing left ready (order 2 still cooking)');
  assert.equal(statusOf(await floorView(uc), 6), 'cooking'); // back to cooking — order 2 still going

  // Finish order 2 and serve it too.
  await uc.kitchen.markAllReady(TENANT, { ticketId: t2.id });
  await drain(outbox, bus);
  assert.equal((await uc.kitchen.readyQueue(TENANT)).value.length, 1, 'order 2 now ready');
  await uc.kitchen.serveTicket(TENANT, { ticketId: t2.id });
  await drain(outbox, bus);
  assert.equal(statusOf(await floorView(uc), 6), 'seated', 'all served -> seated');

  // Then the guest asks for the bill: ONE bill aggregates BOTH orders (4 dishes).
  const billed = await openTableBill({ useCases: uc, tenant: TENANT, table: 'T6' });
  assert.ok(billed.ok);
  assert.equal(billed.value.orderCount, 2);
  assert.equal(billed.value.bill.lines.length, 4, '1 + 3 dishes');
  assert.equal(statusOf(await floorView(uc), 6), 'billing', 'open bill -> billing');
});

test('table accumulates multiple orders; one final categorized bill on request', async () => {
  const app = buildApiApp();
  await seedDemoData(app.useCases, 'acme');
  const { useCases: uc, outbox, bus } = app;
  await drain(outbox, bus);

  const menu = (await uc.catalog.getMenu(TENANT)).value;
  const pick = (n) => menu.find((i) => i.name === n);
  const butter = pick('Butter Chicken'), naan = pick('Garlic Naan'), lassi = pick('Mango Lassi');

  await uc.ordering.placeOrder(TENANT, { tableId: 'T8', items: [{ menuItemId: butter.id, unitPriceMinor: butter.price.minor, qty: 1 }] });
  await drain(outbox, bus);
  await uc.ordering.placeOrder(TENANT, { tableId: 'T8', items: [
    { menuItemId: naan.id, unitPriceMinor: naan.price.minor, qty: 2 },
    { menuItemId: lassi.id, unitPriceMinor: lassi.price.minor, qty: 1 },
  ] });
  await drain(outbox, bus);

  assert.equal((await uc.billing.listOpen(TENANT)).value.length, 0);

  const billed = await openTableBill({ useCases: uc, tenant: TENANT, table: 'T8' });
  assert.ok(billed.ok);
  assert.equal(billed.value.orderCount, 2);
  assert.equal(billed.value.bill.lines.length, 4);
  assert.ok(billed.value.bill.lines.some((l) => l.name === 'Butter Chicken'), 'names resolved');
  assert.ok(billed.value.bill.lines.every((l) => l.category && l.category !== 'Other'), 'every line categorized');
  assert.deepEqual(billed.value.sections.map((s) => s.category), ['Mains', 'Breads', 'Drinks']);
  assert.equal(billed.value.sections.find((s) => s.category === 'Mains').subtotalMinor, 34000);

  const again = await openTableBill({ useCases: uc, tenant: TENANT, table: 'T8' });
  assert.ok(!again.ok, 'no open orders left to bill');
  assert.equal((await uc.billing.listOpen(TENANT)).value.length, 1, 'still exactly one bill');
});

test('billing matches tables tolerantly: order placed as "T9" bills via numeric 9', async () => {
  const app = buildApiApp();
  await seedDemoData(app.useCases, 'acme');
  const { useCases: uc, outbox, bus } = app;
  await drain(outbox, bus);

  const butter = (await uc.catalog.getMenu(TENANT)).value.find((i) => i.name === 'Butter Chicken');
  await uc.ordering.placeOrder(TENANT, { tableId: 'T9', items: [{ menuItemId: butter.id, unitPriceMinor: butter.price.minor, qty: 1 }] });
  await drain(outbox, bus);

  // Billing surface passes the NUMERIC table (9), order was placed as "T9".
  assert.equal((await uc.ordering.listForTable(TENANT, 9)).value.length, 1, 'numeric 9 matches "T9"');
  const billed = await openTableBill({ useCases: uc, tenant: TENANT, table: 9 });
  assert.ok(billed.ok, 'bill generated via numeric table');
  assert.equal(billed.value.orderCount, 1);
});

test('order with an unknown (non-numeric) table still reaches the kitchen', async () => {
  const app = buildApiApp();
  await seedDemoData(app.useCases, 'acme');
  const { useCases: uc, outbox, bus } = app;
  await drain(outbox, bus);

  const lassi = (await uc.catalog.getMenu(TENANT)).value.find((i) => i.name === 'Mango Lassi');
  const placed = await uc.ordering.placeOrder(TENANT, {
    tableId: 'PATIO', items: [{ menuItemId: lassi.id, unitPriceMinor: lassi.price.minor, qty: 1 }],
  });
  assert.ok(placed.ok);
  await drain(outbox, bus);
  assert.ok((await uc.kitchen.getBoard(TENANT)).value.find((t) => t.orderId === placed.value.order.id));
});
