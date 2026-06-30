import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_NUDGE_CONFIG, createNudgeConfigStore } from '../src/config.js';
import { buildNudges } from '../src/engine.js';

const NOW = 1_000_000_000_000;
const cfg = () => structuredClone(DEFAULT_NUDGE_CONFIG);

function tbl(over = {}) {
  return {
    n: 1,
    seatedAt: null,
    greetedAt: null,
    lastServedAt: null,
    lastCheckinAt: null,
    ...over,
  };
}

test('greet fires after delay but not before', () => {
  const before = buildNudges({
    tables: [tbl({ seatedAt: NOW - 29_000 })],
    now: NOW,
    config: cfg(),
  });
  assert.equal(before.length, 0);

  const after = buildNudges({
    tables: [tbl({ seatedAt: NOW - 30_000 })],
    now: NOW,
    config: cfg(),
  });
  assert.equal(after.length, 1);
  assert.equal(after[0].type, 'greet');
  assert.equal(after[0].label, 'Greet the guests');
  assert.equal(after[0].since, NOW - 30_000);
});

test('greet suppressed once greetedAt set', () => {
  const res = buildNudges({
    tables: [tbl({ seatedAt: NOW - 60_000, greetedAt: NOW - 10_000 })],
    now: NOW,
    config: cfg(),
  });
  assert.equal(res.length, 0);
});

test('checkin fires afterServeSecs and not before', () => {
  const before = buildNudges({
    tables: [tbl({ seatedAt: NOW - 9_999_999, greetedAt: NOW - 9_999_999, lastServedAt: NOW - 299_000 })],
    now: NOW,
    config: cfg(),
  });
  assert.equal(before.length, 0);

  const after = buildNudges({
    tables: [tbl({ seatedAt: NOW - 9_999_999, greetedAt: NOW - 9_999_999, lastServedAt: NOW - 300_000 })],
    now: NOW,
    config: cfg(),
  });
  assert.equal(after.length, 1);
  assert.equal(after[0].type, 'checkin');
  assert.equal(after[0].label, 'Ask how the food is');
  assert.equal(after[0].since, NOW - 300_000);
});

test('checkin re-fires after a NEW serve following a check-in', () => {
  // checked in, then a newer serve happened > afterServeSecs ago
  const res = buildNudges({
    tables: [tbl({
      seatedAt: NOW - 9_999_999,
      greetedAt: NOW - 9_999_999,
      lastCheckinAt: NOW - 400_000,
      lastServedAt: NOW - 350_000,
    })],
    now: NOW,
    config: cfg(),
  });
  assert.equal(res.length, 1);
  assert.equal(res[0].type, 'checkin');
  assert.equal(res[0].since, NOW - 350_000);
});

test('anything fires afterCheckinSecs', () => {
  const res = buildNudges({
    tables: [tbl({
      seatedAt: NOW - 9_999_999,
      greetedAt: NOW - 9_999_999,
      lastCheckinAt: NOW - 600_000,
    })],
    now: NOW,
    config: cfg(),
  });
  assert.equal(res.length, 1);
  assert.equal(res[0].type, 'anything');
  assert.equal(res[0].label, 'Check if they need anything');
  assert.equal(res[0].since, NOW - 600_000);
});

test('anything suppressed when a newer serve is pending', () => {
  const res = buildNudges({
    tables: [tbl({
      seatedAt: NOW - 9_999_999,
      greetedAt: NOW - 9_999_999,
      lastCheckinAt: NOW - 700_000,
      lastServedAt: NOW - 100_000, // newer than checkin, but not yet past afterServeSecs
    })],
    now: NOW,
    config: cfg(),
  });
  // anything is suppressed (newer serve pending); checkin not yet due (100s < 300s)
  assert.equal(res.length, 0);
});

test('greet has priority over checkin and anything', () => {
  const res = buildNudges({
    tables: [tbl({
      seatedAt: NOW - 60_000,
      greetedAt: null,
      lastServedAt: NOW - 400_000,
      lastCheckinAt: NOW - 700_000,
    })],
    now: NOW,
    config: cfg(),
  });
  assert.equal(res.length, 1);
  assert.equal(res[0].type, 'greet');
});

test('disabled types never fire', () => {
  const c = cfg();
  c.greet.enabled = false;
  c.checkin.enabled = false;
  c.anythingElse.enabled = false;
  const res = buildNudges({
    tables: [tbl({
      seatedAt: NOW - 60_000,
      lastServedAt: NOW - 400_000,
      lastCheckinAt: NOW - 700_000,
    })],
    now: NOW,
    config: c,
  });
  assert.equal(res.length, 0);
});

test('results sorted by since ascending across tables', () => {
  const res = buildNudges({
    tables: [
      tbl({ n: 5, seatedAt: NOW - 40_000 }),
      tbl({ n: 9, seatedAt: NOW - 90_000 }),
    ],
    now: NOW,
    config: cfg(),
  });
  assert.equal(res.length, 2);
  assert.equal(res[0].table, 9); // oldest since first
  assert.equal(res[1].table, 5);
});

test('config store get returns defaults', () => {
  const store = createNudgeConfigStore();
  const c = store.get({ tenantId: 'acme' });
  assert.deepEqual(c, DEFAULT_NUDGE_CONFIG);
  // returns a copy, not the shared default object
  assert.notEqual(c, DEFAULT_NUDGE_CONFIG);
});

test('config store set merges + persists per tenant', () => {
  const store = createNudgeConfigStore();
  const merged = store.set({ tenantId: 'acme' }, { greet: { delaySecs: 45 } });
  assert.equal(merged.greet.delaySecs, 45);
  assert.equal(merged.greet.enabled, true); // unchanged default preserved
  assert.equal(merged.checkin.afterServeSecs, 300); // other section default preserved

  // persisted
  const again = store.get({ tenantId: 'acme' });
  assert.equal(again.greet.delaySecs, 45);

  // isolation between tenants
  const other = store.get({ tenantId: 'other' });
  assert.equal(other.greet.delaySecs, 30);
});

test('config store set ignores negative/non-integer delays', () => {
  const store = createNudgeConfigStore();
  store.set({ tenantId: 'acme' }, { greet: { delaySecs: 45 } });
  const r1 = store.set({ tenantId: 'acme' }, { greet: { delaySecs: -5 } });
  assert.equal(r1.greet.delaySecs, 45); // negative ignored, previous kept
  const r2 = store.set({ tenantId: 'acme' }, { greet: { delaySecs: 12.5 } });
  assert.equal(r2.greet.delaySecs, 45); // non-integer ignored
  const r3 = store.set({ tenantId: 'acme' }, { greet: { delaySecs: 'soon' } });
  assert.equal(r3.greet.delaySecs, 45); // non-number ignored
});

test('config store set coerces enabled to boolean', () => {
  const store = createNudgeConfigStore();
  const r = store.set({ tenantId: 'acme' }, { checkin: { enabled: 0 } });
  assert.equal(r.checkin.enabled, false);
  const r2 = store.set({ tenantId: 'acme' }, { checkin: { enabled: 1 } });
  assert.equal(r2.checkin.enabled, true);
});
