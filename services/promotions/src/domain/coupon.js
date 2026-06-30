// Promotions domain — coupon aggregate. Pure, no I/O, framework-free.
import { newId } from '#core';

// Create a coupon. `type` is 'percent' (value = 0..100) or 'flat' (value = minor units).
export function createCoupon({
  code,
  type,
  value,
  minOrderMinor = 0,
  usageLimit = Infinity,
  used = 0,
  validUntil = null, // ISO string or null = no expiry
  active = true,
  id = newId('cpn'),
}) {
  return {
    id,
    code,
    type,
    value,
    minOrderMinor,
    usageLimit,
    used,
    validUntil,
    active,
  };
}

// Pure evaluation of a single coupon against a subtotal at a point in time.
// Returns { ok, discountMinor, reason? }. discountMinor is 0 when not applicable.
export function applyCoupon(coupon, subtotalMinor, now = new Date()) {
  if (!coupon.active) return { ok: false, discountMinor: 0, reason: 'inactive' };
  if (coupon.validUntil && new Date(now) > new Date(coupon.validUntil)) {
    return { ok: false, discountMinor: 0, reason: 'expired' };
  }
  if (subtotalMinor < coupon.minOrderMinor) {
    return { ok: false, discountMinor: 0, reason: 'min_order_not_met' };
  }
  if (coupon.used >= coupon.usageLimit) {
    return { ok: false, discountMinor: 0, reason: 'usage_limit_exhausted' };
  }

  let discountMinor;
  if (coupon.type === 'percent') {
    discountMinor = Math.round((subtotalMinor * coupon.value) / 100);
  } else {
    // flat: never discount more than the subtotal.
    discountMinor = Math.min(coupon.value, subtotalMinor);
  }
  return { ok: true, discountMinor };
}
