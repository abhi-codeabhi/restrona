// Application layer — promotions use cases orchestrate domain + ports.
// Local event constants + validators only (dependency-free; no #contracts).
import { ok, err, NotFoundError, ValidationError, newId } from '#core';
import { createCoupon } from '../domain/coupon.js';
import { evaluate as evaluateEngine } from '../domain/engine.js';

// Local event constants for the promotions bounded context.
export const EVENTS = {
  PromoApplied: 'promo.applied',
};

// Event envelope helper (matches the outbox `add(evt)` shape).
const evt = (type, tenantId, payload) => ({
  id: newId('evt'),
  type,
  tenantId,
  occurredAt: new Date().toISOString(),
  schemaVersion: 1,
  payload,
});

// Local validators — return Result<value, ValidationError>.
function validateCreateCoupon(input) {
  const details = [];
  if (!input || typeof input !== 'object') details.push({ field: 'input', msg: 'required' });
  const { code, type, value } = input ?? {};
  if (!code || typeof code !== 'string') details.push({ field: 'code', msg: 'required' });
  if (type !== 'percent' && type !== 'flat') details.push({ field: 'type', msg: "must be 'percent' or 'flat'" });
  if (typeof value !== 'number' || value <= 0) details.push({ field: 'value', msg: 'must be > 0' });
  if (details.length) return err(new ValidationError('Invalid createCoupon input', details));
  return ok({ code, type, value });
}

export function makePromotionsUseCases({ coupons, outbox, clock }) {
  return {
    // Create and persist a coupon (validated code + value > 0).
    async createCoupon(tenant, input) {
      const v = validateCreateCoupon(input);
      if (!v.ok) return v;
      const coupon = createCoupon({ ...input });
      await coupons.save(tenant, coupon);
      return ok(coupon);
    },

    // Toggle a coupon active/inactive by code.
    async toggleCoupon(tenant, { code, active }) {
      const existing = await coupons.findByCode(tenant, code);
      if (!existing) return err(new NotFoundError(`Coupon ${code} not found`));
      const updated = { ...existing, active };
      await coupons.save(tenant, updated);
      return ok(updated);
    },

    // Evaluate the best discount for an order context. Stages promo.applied
    // when a discount is actually granted.
    async evaluate(tenant, context) {
      const known = await coupons.list(tenant);
      const catalogue = known.map((c) => ({ coupon: c, code: c.code }));
      const now = context.now ?? clock.now();
      const result = evaluateEngine({
        subtotalMinor: context.subtotalMinor,
        category: context.category ?? null,
        now,
        coupons: catalogue,
        happyHour: context.happyHour ?? null,
        couponCode: context.couponCode ?? null,
      });
      if (result.discountMinor > 0) {
        outbox.add(evt(EVENTS.PromoApplied, tenant.tenantId, {
          subtotalMinor: context.subtotalMinor,
          discountMinor: result.discountMinor,
          applied: result.applied,
        }));
      }
      return ok({ discountMinor: result.discountMinor, applied: result.applied });
    },
  };
}
