// Application layer — control-plane use cases. Depend on PORTS (directory/outbox), not impls.
import { ok, err, NotFoundError } from '#core';
import { createTenant, addRestaurant, planFee, outletFee } from '../domain/tenant.js';
import { runProvision } from '../domain/provisioning.js';
import { EVENTS, evt } from './events.js';
import { validateProvisionTenant, validateAddRestaurant } from './validators.js';

export function makeTenantUseCases({ directory, outbox, clock }) {
  return {
    async provisionTenant(input) {
      const v = validateProvisionTenant(input);
      if (!v.ok) return v;

      // create -> run provisioning saga -> persist.
      const created = createTenant({ ...v.value, clock });
      const tenant = runProvision(created);
      await directory.save(tenant);

      // Stage events: business write + events would be ONE transaction in prod (outbox).
      outbox.add(evt(EVENTS.TenantProvisioned, tenant.id, {
        tenantId: tenant.id, plan: tenant.plan, tier: tenant.tier,
        region: tenant.region, status: tenant.status,
      }));
      const fee = planFee[tenant.plan];
      outbox.add(evt(EVENTS.UsageMetered, tenant.id, {
        tenantId: tenant.id, sku: 'plan', plan: tenant.plan,
        billable: true, qty: 1, amountMinor: fee, currency: 'INR',
      }));

      return ok({ tenant, tier: tenant.tier });
    },

    async addRestaurant(tenantId, input) {
      const v = validateAddRestaurant(input);
      if (!v.ok) return v;
      const existing = await directory.findById(tenantId);
      if (!existing) return err(new NotFoundError(`Tenant ${tenantId} not found`));

      const updated = addRestaurant(existing, v.value);
      await directory.save(updated);
      const restaurant = updated.restaurants[updated.restaurants.length - 1];

      // Per-outlet metered billing event.
      const fee = outletFee[updated.plan];
      outbox.add(evt(EVENTS.UsageMetered, updated.id, {
        tenantId: updated.id, sku: 'outlet', restaurantId: restaurant.id,
        billable: true, qty: 1, amountMinor: fee, currency: 'INR',
      }));

      return ok({ tenant: updated, restaurant });
    },

    async listTenants() {
      return ok(await directory.list());
    },

    async getTenant(id) {
      const tenant = await directory.findById(id);
      if (!tenant) return err(new NotFoundError(`Tenant ${id} not found`));
      return ok(tenant);
    },
  };
}
