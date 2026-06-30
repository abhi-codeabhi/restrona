import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCoupon, applyCoupon } from '../src/domain/coupon.js';
import { createHappyHour, isActive } from '../src/domain/happyHour.js';
import { evaluate } from '../src/domain/engine.js';

// Dates are built from local components so weekday/time-window checks
// (which use getDay/getHours) are timezone-stable.
// 2026-06-30 is a Tuesday -> Mon-first index 1.
const tueAt = (h, m = 0) => new Date(2026, 5, 30, h, m, 0); // month is 0-based: 5 = June

test('percent coupon computes discount correctly', () => {
  const c = createCoupon({ code: 'SAVE10', type: 'percent', value: 10 });
  const r = applyCoupon(c, 50000, tueAt(13)); // 10% of ₹500.00
  assert.equal(r.ok, true);
  assert.equal(r.discountMinor, 5000); // ₹50.00
});

test('coupon rejected when subtotal below minOrder', () => {
  const c = createCoupon({ code: 'BIG', type: 'flat', value: 10000, minOrderMinor: 100000 });
  const r = applyCoupon(c, 50000, tueAt(13));
  assert.equal(r.ok, false);
  assert.equal(r.discountMinor, 0);
  assert.equal(r.reason, 'min_order_not_met');
});

test('coupon rejected when usage limit exhausted', () => {
  const c = createCoupon({ code: 'ONCE', type: 'percent', value: 20, usageLimit: 3, used: 3 });
  const r = applyCoupon(c, 50000, tueAt(13));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'usage_limit_exhausted');
});

test('coupon rejected when expired', () => {
  const c = createCoupon({ code: 'OLD', type: 'percent', value: 15, validUntil: '2026-01-01T00:00:00Z' });
  const r = applyCoupon(c, 50000, tueAt(13));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
});

test('flat coupon never exceeds subtotal', () => {
  const c = createCoupon({ code: 'FLAT', type: 'flat', value: 99999 });
  const r = applyCoupon(c, 30000, tueAt(13));
  assert.equal(r.ok, true);
  assert.equal(r.discountMinor, 30000);
});

test('happyHour isActive true inside the window', () => {
  // Tue 16:00-18:00, all categories.
  const days = [false, true, false, false, false, false, false]; // Tue only
  const hh = createHappyHour({ days, from: '16:00', to: '18:00', pct: 25, category: null });
  assert.equal(isActive(hh, tueAt(17)), true);
});

test('happyHour isActive false outside the window', () => {
  const days = [false, true, false, false, false, false, false]; // Tue only
  const hh = createHappyHour({ days, from: '16:00', to: '18:00', pct: 25, category: null });
  assert.equal(isActive(hh, tueAt(12)), false); // before window
  assert.equal(isActive(hh, tueAt(19)), false); // after window
});

test('happyHour isActive false on the wrong weekday', () => {
  const days = [true, false, false, false, false, false, false]; // Mon only
  const hh = createHappyHour({ days, from: '16:00', to: '18:00', pct: 25 });
  assert.equal(isActive(hh, tueAt(17)), false); // it's Tuesday
});

test('engine picks the larger of coupon vs happy hour (non-stacking)', () => {
  const days = [false, true, false, false, false, false, false]; // Tue
  const hh = createHappyHour({ days, from: '16:00', to: '18:00', pct: 25, category: null }); // 25%
  const coupon = createCoupon({ code: 'SAVE10', type: 'percent', value: 10 }); // 10%
  const now = tueAt(17);

  const r = evaluate({
    subtotalMinor: 100000, // ₹1000.00
    category: 'mains',
    now,
    coupons: [{ coupon, code: 'SAVE10' }],
    happyHour: hh,
    couponCode: 'SAVE10',
  });

  // happy hour 25% (25000) beats coupon 10% (10000) -> picks happy hour, no sum.
  assert.equal(r.discountMinor, 25000);
  assert.deepEqual(r.applied, ['happyHour']);
});

test('engine picks coupon when it is the larger discount', () => {
  const days = [false, true, false, false, false, false, false];
  const hh = createHappyHour({ days, from: '16:00', to: '18:00', pct: 5, category: null }); // 5%
  const coupon = createCoupon({ code: 'SAVE30', type: 'percent', value: 30 }); // 30%
  const now = tueAt(17);

  const r = evaluate({
    subtotalMinor: 100000,
    category: 'mains',
    now,
    coupons: [{ coupon, code: 'SAVE30' }],
    happyHour: hh,
    couponCode: 'SAVE30',
  });

  assert.equal(r.discountMinor, 30000);
  assert.deepEqual(r.applied, ['coupon:SAVE30']);
});
