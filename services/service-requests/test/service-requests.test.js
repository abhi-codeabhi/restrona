import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemClock } from '#core';
import { InMemoryOutbox, InMemoryEventBus } from '#events';
import { InMemoryRequestRepository } from '../src/adapters/repos.js';
import { makeServiceRequestUseCases, EVENTS } from '../src/application/usecases.js';

const settings = { escalationSecs: 30, cooldownSecs: 60 };

function setup() {
  const requests = new InMemoryRequestRepository();
  const outbox = new InMemoryOutbox();
  const bus = new InMemoryEventBus();
  const uc = makeServiceRequestUseCases({ requests, outbox, clock: systemClock, settings });
  return { uc, requests, outbox, bus };
}

const T = { tenantId: 'acme', tier: 'T1_POOLED', region: 'ap-mumbai-1' };

// A fixed base epoch (ms). We drive time by adding seconds to this anchor.
const T0 = 1_700_000_000_000;
const at = (secs) => T0 + secs * 1000;

test('raise with assignedTo starts in state assigned and stages service.requested', async () => {
  const { uc, outbox } = setup();
  const r = await uc.raise(T, { type: 'water', table: 'T12', assignedTo: 'w1', now: at(0) });
  assert.ok(r.ok);
  assert.equal(r.value.state, 'assigned');
  assert.equal(r.value.assignedTo, 'w1');
  assert.equal(outbox.size(), 1);
  assert.equal(outbox.peek()[0].type, EVENTS.Requested);
});

test('escalateDue flips an assigned request past escalationSecs to escalated + stages event', async () => {
  const { uc, outbox } = setup();
  const raised = await uc.raise(T, { type: 'call', table: 'T1', assignedTo: 'w1', now: at(0) });
  const id = raised.value.id;

  // Before the timeout, nothing escalates.
  let r = await uc.escalateDue(T, { now: at(29) });
  assert.ok(r.ok);
  assert.equal(r.value.length, 0);

  // At/after escalationSecs (30s), it flips to 'escalated'.
  r = await uc.escalateDue(T, { now: at(30) });
  assert.ok(r.ok);
  assert.equal(r.value.length, 1);
  assert.equal(r.value[0].id, id);
  assert.equal(r.value[0].state, 'escalated');

  const escalated = outbox.peek().filter((e) => e.type === EVENTS.Escalated);
  assert.equal(escalated.length, 1);
});

test('acknowledge sets state done, records cooldown, and stages service.acknowledged', async () => {
  const { uc, outbox } = setup();
  const raised = await uc.raise(T, { type: 'bill', table: 'T5', assignedTo: 'w2', now: at(0) });
  const r = await uc.acknowledge(T, { requestId: raised.value.id, now: at(10) });
  assert.ok(r.ok);
  assert.equal(r.value.state, 'done');
  assert.equal(r.value.ackedAt, at(10));

  const acked = outbox.peek().filter((e) => e.type === EVENTS.Acknowledged);
  assert.equal(acked.length, 1);

  // Acknowledged requests drop off the open list.
  const open = await uc.listOpen(T);
  assert.ok(open.ok);
  assert.equal(open.value.length, 0);
});

test('raising the same table+type within cooldown is RATE_LIMITED', async () => {
  const { uc } = setup();
  const raised = await uc.raise(T, { type: 'water', table: 'T8', assignedTo: 'w1', now: at(0) });
  await uc.acknowledge(T, { requestId: raised.value.id, now: at(5) });

  // 30s later (< 60s cooldown) -> rejected.
  const r = await uc.raise(T, { type: 'water', table: 'T8', assignedTo: 'w1', now: at(35) });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'RATE_LIMITED');
});

test('after the cooldown elapses, raising the same table+type succeeds again', async () => {
  const { uc } = setup();
  const raised = await uc.raise(T, { type: 'water', table: 'T9', assignedTo: 'w1', now: at(0) });
  await uc.acknowledge(T, { requestId: raised.value.id, now: at(5) });

  // ackedAt = 5s; cooldown of 60s clears at 65s. Raise at 70s succeeds.
  const r = await uc.raise(T, { type: 'water', table: 'T9', assignedTo: 'w1', now: at(70) });
  assert.ok(r.ok);
  assert.equal(r.value.state, 'assigned');

  // A different type at the same table is never blocked by the water cooldown.
  const other = await uc.raise(T, { type: 'cutlery', table: 'T9', assignedTo: 'w1', now: at(10) });
  assert.ok(other.ok);
});
