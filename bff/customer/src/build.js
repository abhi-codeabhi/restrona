// Composition root for the Customer BFF.
// Wires the use cases of four bounded-context services around ONE shared
// InMemoryEventBus + InMemoryOutbox + systemClock, seeds demo data for tenant
// 'acme', and exposes the HTTP server. Contains NO business rules.
import { systemClock, createLogger } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';

import { makeCatalogUseCases } from '../../../services/catalog/src/application/usecases.js';
import { InMemoryItemRepository } from '../../../services/catalog/src/adapters/repos.js';

import { makeUseCases as makeOrderingUseCases } from '../../../services/ordering/src/application/usecases.js';
import { InMemoryOrderRepository, InMemorySessionRepository } from '../../../services/ordering/src/adapters/repos.js';

import { makePromotionsUseCases } from '../../../services/promotions/src/application/usecases.js';
import { InMemoryCouponRepository } from '../../../services/promotions/src/adapters/repos.js';

import { makeServiceRequestUseCases } from '../../../services/service-requests/src/application/usecases.js';
import { InMemoryRequestRepository } from '../../../services/service-requests/src/adapters/repos.js';

import { createServer } from './server.js';

// Build the wired use cases + shared infra, WITHOUT starting an HTTP listener.
// Returns everything tests need; the listening variant builds on top of this.
export function buildCustomerBffApp() {
  const logger = createLogger({ service: 'bff-customer' });

  // ONE shared bus + outbox + clock across every composed service.
  const bus = new InMemoryEventBus();
  const outbox = new InMemoryOutbox();
  const clock = systemClock;

  // Repositories (one per aggregate; tenant-partitioned).
  const items = new InMemoryItemRepository();
  const orders = new InMemoryOrderRepository();
  const sessions = new InMemorySessionRepository();
  const coupons = new InMemoryCouponRepository();
  const requests = new InMemoryRequestRepository();

  // Use cases, each given the shared outbox/clock so events funnel into one outbox.
  const catalog = makeCatalogUseCases({ items, outbox, clock });
  const ordering = makeOrderingUseCases({ orders, sessions, outbox, clock });
  const promotions = makePromotionsUseCases({ coupons, outbox, clock });
  const serviceRequests = makeServiceRequestUseCases({
    requests, outbox, clock,
    settings: { escalationSecs: 30, cooldownSecs: 60 },
  });

  const useCases = { catalog, ordering, promotions, serviceRequests };

  return { useCases, bus, outbox, clock, logger, repos: { items, orders, sessions, coupons, requests } };
}

// Seed demo data for a single tenant (default 'acme'): a few menu items + one coupon.
export async function seedDemoData(useCases, tenantId = 'acme') {
  const tenant = { tenantId, tier: 'T1_POOLED', region: 'ap-mumbai-1' };

  await useCases.catalog.addItem(tenant, {
    name: 'Paneer Tikka Bowl', priceMinor: 24000, veg: true,
    tags: { veg: 1, dairy: 1 },
  });
  await useCases.catalog.addItem(tenant, {
    name: 'Garlic Naan', priceMinor: 6000, veg: true,
    tags: { veg: 1, gluten: 1, dairy: 1 },
  });
  await useCases.catalog.addItem(tenant, {
    name: 'Butter Chicken', priceMinor: 34000, veg: false,
    tags: { meat: 1, dairy: 1 },
  });
  await useCases.catalog.addItem(tenant, {
    name: 'Mango Lassi', priceMinor: 12000, veg: true,
    tags: { veg: 1, dairy: 1, sugar: 1 },
  });

  await useCases.promotions.createCoupon(tenant, {
    code: 'WELCOME20', type: 'percent', value: 20, minOrderMinor: 30000,
  });
}

// Full build: composition root + seeded demo data + HTTP server, ready to listen.
export function buildCustomerBff() {
  const { useCases, bus, outbox, clock, logger, repos } = buildCustomerBffApp();
  const server = createServer({ useCases, outbox, bus, logger });
  // Seed asynchronously; callers that need to await seeding should use buildSeeded().
  return { server, useCases, bus, outbox, clock, logger, repos };
}

// Test/helper variant: build + seed (awaited) + server, but do NOT listen.
export async function buildSeededCustomerBff(tenantId = 'acme') {
  const { useCases, bus, outbox, clock, logger, repos } = buildCustomerBffApp();
  await seedDemoData(useCases, tenantId);
  const server = createServer({ useCases, outbox, bus, logger });
  return { server, useCases, bus, outbox, clock, logger, repos };
}

// node bff/customer/src/build.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, useCases, logger } = buildCustomerBff();
  await seedDemoData(useCases, 'acme');
  const port = process.env.PORT || 3010;
  server.listen(port, () => logger.info('bff-customer.listening', { port }));
}
