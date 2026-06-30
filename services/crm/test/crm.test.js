import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemClock } from '#core';
import { InMemoryOutbox, InMemoryEventBus } from '#events';
import { InMemoryGuestRepository } from '../src/adapters/repos.js';
import { makeCrmUseCases, EVENTS } from '../src/application/usecases.js';

function setup() {
  const guests = new InMemoryGuestRepository();
  const outbox = new InMemoryOutbox();
  const bus = new InMemoryEventBus();
  const uc = makeCrmUseCases({ guests, outbox, clock: systemClock });
  return { uc, guests, outbox, bus };
}
const T = { tenantId: 'acme', tier: 'T1_POOLED', region: 'ap-mumbai-1' };

test('upsertGuest then recordVisit twice increments visits to 2 and accumulates spend', async () => {
  const { uc } = setup();
  const g = await uc.upsertGuest(T, { name: 'Yashvi', phone: '+91-99999' });
  assert.ok(g.ok);
  assert.equal(g.value.visits, 0);

  await uc.recordVisit(T, { guestId: g.value.id, spentMinor: 24000, items: ['Paneer'] });
  const r2 = await uc.recordVisit(T, { guestId: g.value.id, spentMinor: 36000, items: ['Dal'] });
  assert.ok(r2.ok);
  assert.equal(r2.value.visits, 2);
  assert.equal(r2.value.totalSpentMinor, 60000);
});

test('usualItem returns the most-ordered item', async () => {
  const { uc } = setup();
  const g = await uc.upsertGuest(T, { name: 'Rahul' });
  const id = g.value.id;
  await uc.recordVisit(T, { guestId: id, spentMinor: 10000, items: ['Paneer', 'Naan'] });
  await uc.recordVisit(T, { guestId: id, spentMinor: 10000, items: ['Paneer'] });
  const chit = await uc.getChit(T, { guestId: id });
  assert.ok(chit.ok);
  assert.equal(chit.value.usual, 'Paneer');
});

test('getChit returns a chit including tier, usual item, and allergies', async () => {
  const { uc } = setup();
  const g = await uc.upsertGuest(T, { name: 'Meera' });
  const id = g.value.id;
  for (let i = 0; i < 4; i++) await uc.recordVisit(T, { guestId: id, spentMinor: 20000, items: ['Biryani'] });
  await uc.setPreferences(T, { guestId: id, allergies: ['peanuts'], prefs: ['window seat'] });

  const chit = await uc.getChit(T, { guestId: id });
  assert.ok(chit.ok);
  assert.equal(chit.value.tier, 'Silver'); // 4 visits
  assert.equal(chit.value.usual, 'Biryani');
  assert.deepEqual(chit.value.allergies, ['peanuts']);
  assert.equal(chit.value.visits, 4);
  assert.equal(typeof chit.value.avgSpend, 'string'); // Money-formatted
});

test('setPreferences updates allergies and stages the event', async () => {
  const { uc, guests, outbox } = setup();
  const g = await uc.upsertGuest(T, { name: 'Arjun' });
  const id = g.value.id;
  const before = outbox.size();

  const r = await uc.setPreferences(T, { guestId: id, allergies: ['gluten'], prefs: ['no spice'] });
  assert.ok(r.ok);
  assert.deepEqual(r.value.allergies, ['gluten']);
  assert.deepEqual(r.value.prefs, ['no spice']);

  const persisted = await guests.findById(T, id);
  assert.deepEqual(persisted.allergies, ['gluten']);

  assert.equal(outbox.size(), before + 1);
  assert.equal(outbox.peek().at(-1).type, EVENTS.PreferenceUpdated);
});

test('getChit on unknown guest returns NotFound', async () => {
  const { uc } = setup();
  const r = await uc.getChit(T, { guestId: 'gst_missing' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NOT_FOUND');
});
