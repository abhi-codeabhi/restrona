import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemClock } from '#core';
import { InMemoryOutbox, InMemoryEventBus } from '#events';
import { InMemoryItemRepository } from '../src/adapters/repos.js';
import { makeCatalogUseCases, CATALOG_EVENTS } from '../src/application/usecases.js';
import { createItem } from '../src/domain/menuItem.js';
import { evaluateItem } from '../src/domain/dietary.js';

function setup() {
  const items = new InMemoryItemRepository();
  const outbox = new InMemoryOutbox();
  const bus = new InMemoryEventBus();
  const uc = makeCatalogUseCases({ items, outbox, clock: systemClock });
  return { uc, items, outbox, bus };
}
const T = { tenantId: 'acme', tier: 'T1_POOLED', region: 'ap-mumbai-1' };

test('addItem persists a menu item', async () => {
  const { uc, items } = setup();
  const r = await uc.addItem(T, { name: 'Paneer Tikka', categoryId: 'starters', priceMinor: 24000, veg: true });
  assert.ok(r.ok);
  assert.equal(r.value.available, true);
  assert.equal(r.value.price.minor, 24000);
  const stored = await items.findById(T, r.value.id);
  assert.equal(stored.name, 'Paneer Tikka');
});

test('addItem rejects invalid input (missing name / non-positive price / qty present)', async () => {
  const { uc } = setup();
  const r = await uc.addItem(T, { name: '', priceMinor: 0, qty: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'VALIDATION');
  assert.ok(Array.isArray(r.error.details));
  assert.ok(r.error.details.length >= 2);
});

test('toggleAvailability false makes item unavailable AND stages catalog.item.86d in outbox', async () => {
  const { uc, items, outbox } = setup();
  const added = await uc.addItem(T, { name: 'Fish Curry', priceMinor: 32000 });
  const r = await uc.toggleAvailability(T, { itemId: added.value.id, available: false });
  assert.ok(r.ok);
  assert.equal(r.value.available, false);
  const stored = await items.findById(T, added.value.id);
  assert.equal(stored.available, false);
  assert.equal(outbox.size(), 1);
  assert.equal(outbox.peek()[0].type, CATALOG_EVENTS.ItemEightySixed);
  assert.equal(outbox.peek()[0].payload.itemId, added.value.id);
});

test('getMenu returns only available items', async () => {
  const { uc } = setup();
  const a = await uc.addItem(T, { name: 'Dal', priceMinor: 18000 });
  await uc.addItem(T, { name: 'Naan', priceMinor: 5000 });
  await uc.toggleAvailability(T, { itemId: a.value.id, available: false });
  const menu = await uc.getMenu(T);
  assert.ok(menu.ok);
  assert.equal(menu.value.length, 1);
  assert.equal(menu.value[0].name, 'Naan');
});

test('dietary: vegan flags a dairy item with a reason, passes a vegan-safe item', async () => {
  const paneer = createItem({ name: 'Paneer Butter Masala', priceMinor: 26000, veg: true, tags: { dairy: 1 } });
  const flagged = evaluateItem(paneer, ['vegan']);
  assert.equal(flagged.ok, false);
  assert.ok(flagged.reasons.length >= 1);
  assert.ok(flagged.reasons.some((r) => r.includes('dairy')));

  const chana = createItem({ name: 'Chana Masala', priceMinor: 20000, veg: true, tags: {} });
  const safe = evaluateItem(chana, ['vegan']);
  assert.equal(safe.ok, true);
  assert.equal(safe.reasons.length, 0);
});

test('dietary: pregnancy flags a fish item', async () => {
  const fish = createItem({ name: 'Grilled Fish', priceMinor: 36000, tags: { fish: 1 } });
  const res = evaluateItem(fish, ['pregnancy']);
  assert.equal(res.ok, false);
  assert.ok(res.reasons.some((r) => r.includes('fish')));
});

test('evaluateMenu returns each available item with evaluation', async () => {
  const { uc } = setup();
  await uc.addItem(T, { name: 'Veg Biryani', priceMinor: 22000, veg: true, tags: {} });
  await uc.addItem(T, { name: 'Mutton Roll', priceMinor: 28000, tags: { meat: 1 } });
  const r = await uc.evaluateMenu(T, { prefs: ['vegetarian'] });
  assert.ok(r.ok);
  assert.equal(r.value.length, 2);
  const mutton = r.value.find((x) => x.item.name === 'Mutton Roll');
  assert.equal(mutton.ok, false);
});

test('publishMenu bumps version and emits catalog.menu.published', async () => {
  const { uc, outbox } = setup();
  await uc.addItem(T, { name: 'Idli', priceMinor: 8000, veg: true });
  const r1 = await uc.publishMenu(T);
  assert.ok(r1.ok);
  assert.equal(r1.value.version, 1);
  const r2 = await uc.publishMenu(T);
  assert.equal(r2.value.version, 2);
  const published = outbox.peek().filter((e) => e.type === CATALOG_EVENTS.MenuPublished);
  assert.equal(published.length, 2);
});
