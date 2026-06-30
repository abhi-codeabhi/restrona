import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryOutbox } from '#events';
import { InMemoryFloorRepository } from '../src/adapters/repos.js';
import { makeFloorUseCases } from '../src/application/usecases.js';
import { EVENTS } from '../src/application/events.js';

function setup() {
  const floor = new InMemoryFloorRepository();
  const outbox = new InMemoryOutbox();
  const uc = makeFloorUseCases({ floor, outbox });
  return { uc, floor, outbox };
}
const T = { tenantId: 'acme', tier: 'T1_POOLED', region: 'ap-mumbai-1' };

const tableOf = (doc, n) => doc.tables.find((t) => t.n === n);

test('seat sets a table to seated', async () => {
  const { uc } = setup();
  await uc.initFloor(T, { tableNumbers: [12, 7, 3] });
  const r = await uc.seatTable(T, { n: 12 });
  assert.ok(r.ok);
  assert.equal(tableOf(r.value, 12).status, 'seated');
});

test('assignWaiter sets the waiterId', async () => {
  const { uc } = setup();
  await uc.initFloor(T, { tableNumbers: [12, 7] });
  const r = await uc.assignWaiter(T, { n: 7, waiterId: 'w_ramesh' });
  assert.ok(r.ok);
  assert.equal(tableOf(r.value, 7).waiterId, 'w_ramesh');
});

test('move to a FREE table transfers the order and frees the source', async () => {
  const { uc } = setup();
  await uc.initFloor(T, { tableNumbers: [12, 7] });
  await uc.seatTable(T, { n: 12, order: 'ord_1' });
  await uc.assignWaiter(T, { n: 12, waiterId: 'w_a' });

  const r = await uc.moveTable(T, { srcN: 12, dstN: 7 });
  assert.ok(r.ok);
  assert.equal(r.value.verb, 'moved');

  const f = (await uc.getFloor(T)).value;
  assert.equal(tableOf(f, 7).order, 'ord_1');     // dst received the order
  assert.equal(tableOf(f, 7).status, 'seated');
  assert.equal(tableOf(f, 7).waiterId, 'w_a');
  assert.equal(tableOf(f, 12).status, 'free');    // src freed
  assert.equal(tableOf(f, 12).order, null);
  assert.equal(tableOf(f, 12).waiterId, null);
});

test('SWAP between two occupied tables exchanges their orders', async () => {
  const { uc } = setup();
  await uc.initFloor(T, { tableNumbers: [12, 7] });
  await uc.seatTable(T, { n: 12, order: 'ord_A' });
  await uc.seatTable(T, { n: 7, order: 'ord_B' });

  const r = await uc.moveTable(T, { srcN: 12, dstN: 7 });
  assert.ok(r.ok);
  assert.equal(r.value.verb, 'swapped');

  const f = (await uc.getFloor(T)).value;
  assert.equal(tableOf(f, 12).order, 'ord_B');
  assert.equal(tableOf(f, 7).order, 'ord_A');
});

test('moving a FREE table throws DomainError', async () => {
  const { uc } = setup();
  await uc.initFloor(T, { tableNumbers: [12, 7] });
  await assert.rejects(
    () => uc.moveTable(T, { srcN: 12, dstN: 7 }), // 12 is free
    (e) => e.name === 'DomainError' && e.code === 'NOTHING_TO_MOVE',
  );
});

test('move stages an event with the right verb', async () => {
  const { uc, outbox } = setup();
  await uc.initFloor(T, { tableNumbers: [12, 7] });
  await uc.seatTable(T, { n: 12, order: 'ord_1' });

  await uc.moveTable(T, { srcN: 12, dstN: 7 }); // MOVE -> free dst
  const moved = outbox.peek().at(-1);
  assert.equal(moved.type, EVENTS.TableMoved);
  assert.equal(moved.payload.verb, 'moved');

  await uc.seatTable(T, { n: 12, order: 'ord_2' }); // re-occupy 12
  await uc.moveTable(T, { srcN: 12, dstN: 7 }); // SWAP -> busy dst
  const swapped = outbox.peek().at(-1);
  assert.equal(swapped.type, EVENTS.TableSwapped);
  assert.equal(swapped.payload.verb, 'swapped');
});
