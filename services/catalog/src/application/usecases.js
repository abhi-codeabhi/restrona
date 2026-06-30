// Application layer — catalog use cases. Orchestrate domain + ports; depend on PORTS, not impls.
import { ok, err, NotFoundError, ValidationError, newId } from '#core';
import { createItem, setAvailability } from '../domain/menuItem.js';
import { evaluateItem } from '../domain/dietary.js';

// Event-name constants defined LOCALLY in this service (contracts package is not edited).
export const CATALOG_EVENTS = {
  ItemEightySixed: 'catalog.item.86d',
  MenuPublished: 'catalog.menu.published',
};

// Local event envelope helper (mirrors the platform envelope shape).
const evt = (type, tenantId, payload) => ({
  id: newId('evt'),
  type,
  tenantId,
  occurredAt: new Date().toISOString(),
  schemaVersion: 1,
  payload,
});

// Local validators for addItem input.
function validateAddItem(input = {}) {
  const details = [];
  if (!input.name || !String(input.name).trim()) details.push({ field: 'name', message: 'name is required' });
  if (!Number.isInteger(input.priceMinor) || input.priceMinor <= 0) {
    details.push({ field: 'priceMinor', message: 'priceMinor must be a positive integer (paise)' });
  }
  if ('qty' in input) details.push({ field: 'qty', message: 'qty is not allowed on a menu item' });
  if (details.length) return err(new ValidationError('Invalid menu item', details));
  return ok(input);
}

export function makeCatalogUseCases({ items, outbox, clock }) {
  // Menu version is tracked per tenant; bumped on publish.
  const versions = new Map();
  const bumpVersion = (tenantId) => {
    const next = (versions.get(tenantId) ?? 0) + 1;
    versions.set(tenantId, next);
    return next;
  };

  return {
    async addItem(tenant, input) {
      const v = validateAddItem(input);
      if (!v.ok) return v;
      const item = createItem({
        name: input.name,
        categoryId: input.categoryId,
        category: input.category,
        priceMinor: input.priceMinor,
        veg: input.veg,
        tags: input.tags,
        prepMinutes: input.prepMinutes,
      });
      await items.save(tenant, item);
      return ok(item);
    },

    async toggleAvailability(tenant, { itemId, available }) {
      const existing = await items.findById(tenant, itemId);
      if (!existing) return err(new NotFoundError(`Item ${itemId} not found`));
      const updated = setAvailability(existing, available);
      await items.save(tenant, updated);
      // "86" an item — emit only when it goes unavailable (out of stock / pulled).
      if (!updated.available) {
        outbox.add(evt(CATALOG_EVENTS.ItemEightySixed, tenant.tenantId, {
          itemId: updated.id, name: updated.name,
        }));
      }
      return ok(updated);
    },

    async getMenu(tenant) {
      const all = await items.list(tenant);
      return ok(all.filter((it) => it.available));
    },

    // Manager view: every item including unavailable ones (to toggle them).
    async listAll(tenant) {
      return ok(await items.list(tenant));
    },

    // Resolve a single item by id (used by the order-flow saga to turn an order
    // line's menuItemId into a human name + station for the kitchen ticket).
    async getItem(tenant, itemId) {
      const item = await items.findById(tenant, itemId);
      if (!item) return err(new NotFoundError(`Item ${itemId} not found`));
      return ok(item);
    },

    async evaluateMenu(tenant, { prefs = [] } = {}) {
      const all = await items.list(tenant);
      const active = all.filter((it) => it.available);
      const evaluated = active.map((item) => ({ item, ...evaluateItem(item, prefs) }));
      return ok(evaluated);
    },

    async publishMenu(tenant) {
      const version = bumpVersion(tenant.tenantId);
      const all = await items.list(tenant);
      const itemCount = all.filter((it) => it.available).length;
      outbox.add(evt(CATALOG_EVENTS.MenuPublished, tenant.tenantId, { version, itemCount }));
      return ok({ version, itemCount });
    },
  };
}
