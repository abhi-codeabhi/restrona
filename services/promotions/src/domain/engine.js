// Promotions domain — discount engine. Combines a coupon and a happy-hour rule.
// Pure, no I/O.
import { applyCoupon } from './coupon.js';
import { discountFor } from './happyHour.js';

// Evaluate the best available discount for a context.
//   coupons:    [{ coupon, code }] — the catalogue to match couponCode against.
//   couponCode: the code the customer entered (optional).
//   happyHour:  a HappyHour rule (optional).
//
// Non-stacking policy: a coupon and a happy hour do NOT combine. We deliberately
// take the LARGER of the two discounts (most customer-friendly) rather than
// summing them, so a single best promotion wins.
export function evaluate({
  subtotalMinor,
  category = null,
  now = new Date(),
  coupons = [],
  happyHour = null,
  couponCode = null,
}) {
  const candidates = [];

  // Coupon candidate (only if a code was supplied and it matches + applies).
  if (couponCode) {
    const match = coupons.find((c) => c.code === couponCode);
    if (match) {
      const res = applyCoupon(match.coupon, subtotalMinor, now);
      if (res.ok && res.discountMinor > 0) {
        candidates.push({ name: `coupon:${match.code}`, discountMinor: res.discountMinor });
      }
    }
  }

  // Happy hour candidate.
  if (happyHour) {
    const hhDiscount = discountFor(happyHour, subtotalMinor, category, now);
    if (hhDiscount > 0) {
      candidates.push({ name: 'happyHour', discountMinor: hhDiscount });
    }
  }

  if (candidates.length === 0) return { discountMinor: 0, applied: [] };

  // Take the single larger discount (non-stacking).
  const best = candidates.reduce((a, b) => (b.discountMinor > a.discountMinor ? b : a));
  return { discountMinor: best.discountMinor, applied: [best.name] };
}
