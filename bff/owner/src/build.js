// Composition root for the Owner/admin BFF. Reuses the catalog service so Menu-IQ
// reflects the real menu; ops metrics are illustrative pending the Analytics service.
import { systemClock, createLogger } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';
import { makeCatalogUseCases } from '../../../services/catalog/src/application/usecases.js';
import { InMemoryItemRepository } from '../../../services/catalog/src/adapters/repos.js';
import { makePromotionsUseCases } from '../../../services/promotions/src/application/usecases.js';
import { InMemoryCouponRepository } from '../../../services/promotions/src/adapters/repos.js';
import { createServer } from './server.js';

export function buildOwnerBffApp() {
  const logger = createLogger({ service: 'bff-owner' });
  const bus = new InMemoryEventBus();
  const outbox = new InMemoryOutbox();
  const clock = systemClock;
  const items = new InMemoryItemRepository();
  const coupons = new InMemoryCouponRepository();
  const catalog = makeCatalogUseCases({ items, outbox, clock });
  const promotions = makePromotionsUseCases({ coupons, outbox, clock });
  return { useCases: { catalog, promotions }, bus, outbox, clock, logger, repos: { items, coupons } };
}

export async function seedDemoData(useCases, tenantId = 'acme') {
  const tenant = { tenantId, tier: 'T1_POOLED', region: 'ap-mumbai-1' };
  const menu = [
    ['Butter Chicken', 34000, false], ['Garlic Naan', 6000, true], ['Paneer Tikka Bowl', 24000, true],
    ['Dal Makhani', 22000, true], ['Lamb Shank', 52000, false], ['Saffron Kulfi', 14000, true],
    ['House Salad', 18000, true], ['Mango Lassi', 12000, true],
  ];
  for (const [name, priceMinor, veg] of menu) {
    await useCases.catalog.addItem(tenant, { name, priceMinor, veg, tags: {} });
  }
  await useCases.promotions.createCoupon(tenant, { code: 'WELCOME20', type: 'percent', value: 20, minOrderMinor: 30000 });
}

export async function buildSeededOwnerBff(tenantId = 'acme') {
  const { useCases, bus, outbox, clock, logger, repos } = buildOwnerBffApp();
  await seedDemoData(useCases, tenantId);
  const server = createServer({ useCases, logger });
  return { server, useCases, bus, outbox, clock, logger, repos };
}

export function buildOwnerBff() {
  const { useCases, bus, outbox, clock, logger, repos } = buildOwnerBffApp();
  const server = createServer({ useCases, logger });
  return { server, useCases, bus, outbox, clock, logger, repos };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, useCases, logger } = buildOwnerBff();
  await seedDemoData(useCases, 'acme');
  const port = process.env.PORT || 3014;
  server.listen(port, () => logger.info('bff-owner.listening', { port }));
}
