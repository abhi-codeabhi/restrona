// Tenant (control-plane) domain — pure aggregate. No I/O, no framework.
// This is the GLOBAL tenant registry: tenants are NOT tenant-partitioned themselves.
import { newId, systemClock, ValidationError } from '#core';

// Plan -> isolation tier mapping (the tenancy spec's T1/T2/T3 model).
const PLAN_TIER = {
  Starter: 'T1_POOLED',
  Growth: 'T1_POOLED',
  Scale: 'T2_SCHEMA',
};

// Monthly subscription fee per plan (integer rupees).
export const planFee = Object.freeze({ Starter: 4999, Growth: 9999, Scale: 24999 });
// Per-outlet (restaurant) monthly fee per plan (integer rupees).
export const outletFee = Object.freeze({ Starter: 2999, Growth: 1999, Scale: 1499 });

export const PLANS = Object.freeze(['Starter', 'Growth', 'Scale']);

/** Derive the isolation tier from plan + optional enterprise add-on. */
export function tierFor(plan, { enterprise = false } = {}) {
  if (enterprise) return 'T3_DATABASE';
  const tier = PLAN_TIER[plan];
  if (!tier) throw new ValidationError(`Unknown plan: ${plan}`);
  return tier;
}

export function createTenant({ owner, email, plan, region = 'ap-mumbai-1', addOn = null, id = newId('ten'), clock = systemClock }) {
  if (!PLANS.includes(plan)) throw new ValidationError(`Invalid plan: ${plan}`, [`plan must be one of ${PLANS.join('|')}`]);
  const enterprise = addOn === 'enterprise';
  return {
    id,
    owner,
    email,
    plan,
    region,
    addOn,
    tier: tierFor(plan, { enterprise }),
    restaurants: [],
    status: 'provisioning',
    createdAt: clock.now().toISOString(),
  };
}

export function addRestaurant(tenant, { name, brand = null, city = null }) {
  if (!name) throw new ValidationError('Restaurant name is required', ['name is required']);
  const restaurant = { id: newId('rst'), name, brand, city, status: 'onboarding' };
  return { ...tenant, restaurants: [...tenant.restaurants, restaurant] };
}
