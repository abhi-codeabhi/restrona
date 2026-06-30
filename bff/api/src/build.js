// Composition root for the UNIFIED API — wires EVERY bounded context around ONE
// shared InMemoryEventBus + InMemoryOutbox + clock, registers the order-flow saga,
// seeds demo data, and exposes a single HTTP server. Because all contexts share
// one store and one bus, an order placed by a customer becomes a kitchen ticket,
// seats the waiter's floor, and (on bump) opens a bill — live, in one process.
//
// buildApiFromEnv(): in-memory by default; Postgres-backed when DATABASE_URL is
// set (durable, Supabase). The wiring is identical — only the repos change.
import { systemClock, createLogger } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';

import { makeCatalogUseCases } from '../../../services/catalog/src/application/usecases.js';
import { makeUseCases as makeOrderingUseCases } from '../../../services/ordering/src/application/usecases.js';
import { makeKitchenUseCases } from '../../../services/kitchen/src/application/usecases.js';
import { makeFloorUseCases } from '../../../services/floor/src/application/usecases.js';
import { makeBillingUseCases } from '../../../services/billing/src/application/usecases.js';
import { makePromotionsUseCases } from '../../../services/promotions/src/application/usecases.js';
import { makeServiceRequestUseCases } from '../../../services/service-requests/src/application/usecases.js';

import { InMemoryItemRepository } from '../../../services/catalog/src/adapters/repos.js';
import { InMemoryOrderRepository, InMemorySessionRepository } from '../../../services/ordering/src/adapters/repos.js';
import { InMemoryTicketRepository } from '../../../services/kitchen/src/adapters/repos.js';
import { InMemoryFloorRepository } from '../../../services/floor/src/adapters/repos.js';
import { InMemoryBillRepository } from '../../../services/billing/src/adapters/repos.js';
import { InMemoryCouponRepository } from '../../../services/promotions/src/adapters/repos.js';
import { InMemoryRequestRepository } from '../../../services/service-requests/src/adapters/repos.js';

import { registerOrderFlowSaga } from '../../../services/orchestration/src/saga.js';
import { createServer } from './server.js';

// Build the wired use cases + shared infra around an injected set of repos.
// `repos` defaults to the in-memory family; the Postgres path injects its own.
export function buildApiApp({ repos, logger } = {}) {
  logger = logger || createLogger({ service: 'restorna-api' });

  const bus = new InMemoryEventBus();
  const outbox = new InMemoryOutbox();
  const clock = systemClock;

  repos = repos || {
    items: new InMemoryItemRepository(),
    orders: new InMemoryOrderRepository(),
    sessions: new InMemorySessionRepository(),
    tickets: new InMemoryTicketRepository(),
    floor: new InMemoryFloorRepository(),
    bills: new InMemoryBillRepository(),
    coupons: new InMemoryCouponRepository(),
    requests: new InMemoryRequestRepository(),
  };

  // Every context shares the ONE outbox/clock so events funnel into one stream.
  const catalog = makeCatalogUseCases({ items: repos.items, outbox, clock });
  const ordering = makeOrderingUseCases({ orders: repos.orders, sessions: repos.sessions, outbox, clock });
  const kitchen = makeKitchenUseCases({ tickets: repos.tickets, outbox, clock });
  const floor = makeFloorUseCases({ floor: repos.floor, outbox });
  const billing = makeBillingUseCases({ bills: repos.bills, outbox, clock });
  const promotions = makePromotionsUseCases({ coupons: repos.coupons, outbox, clock });
  const serviceRequests = makeServiceRequestUseCases({
    requests: repos.requests, outbox, clock,
    settings: { escalationSecs: 30, cooldownSecs: 60 },
  });

  const useCases = { catalog, ordering, kitchen, floor, billing, promotions, serviceRequests };

  // THE BRAIN: connect the contexts. Subscribes to the shared bus; fires when the
  // server relays the outbox after each successful command.
  registerOrderFlowSaga({ bus, useCases, logger });

  return { useCases, bus, outbox, clock, logger, repos };
}

// Seed demo data for one tenant: a categorised menu, a coupon, and an initialized
// floor with a few tables so the waiter surface is alive from first boot.
export async function seedDemoData(useCases, tenantId = 'acme') {
  const tenant = { tenantId, tier: 'T1_POOLED', region: 'ap-mumbai-1' };

  await useCases.catalog.addItem(tenant, { name: 'Paneer Tikka Bowl', category: 'Appetizers', priceMinor: 24000, veg: true, tags: { veg: 1, dairy: 1 }, prepMinutes: 12 });
  await useCases.catalog.addItem(tenant, { name: 'Butter Chicken', category: 'Mains', priceMinor: 34000, veg: false, tags: { meat: 1, dairy: 1 }, prepMinutes: 18 });
  await useCases.catalog.addItem(tenant, { name: 'Veg Biryani', category: 'Mains', priceMinor: 22000, veg: true, tags: { veg: 1 }, prepMinutes: 20 });
  await useCases.catalog.addItem(tenant, { name: 'Garlic Naan', category: 'Breads', priceMinor: 6000, veg: true, tags: { veg: 1, gluten: 1, dairy: 1 }, prepMinutes: 6 });
  await useCases.catalog.addItem(tenant, { name: 'Mango Lassi', category: 'Drinks', priceMinor: 12000, veg: true, tags: { veg: 1, dairy: 1, sugar: 1 }, prepMinutes: 3 });

  await useCases.promotions.createCoupon(tenant, { code: 'WELCOME20', type: 'percent', value: 20, minOrderMinor: 30000 });

  await useCases.floor.initFloor(tenant, { tableNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 12] });
}

// Full build + seeded demo data + NOT-yet-listening server (used by serve.js/tests).
export async function buildSeededApi(tenantId = 'acme') {
  const app = buildApiApp();
  await seedDemoData(app.useCases, tenantId);
  const server = createServer(app);
  return { ...app, server };
}

// Env-aware build: Postgres-backed when DATABASE_URL is set, else in-memory.
// Postgres repos are loaded lazily so the dependency-free in-memory path (tests,
// local dev) never imports `pg`.
export async function buildApiFromEnv() {
  if (process.env.DATABASE_URL) {
    const { buildPostgresRepos } = await import('./postgresRepos.js');
    const logger = createLogger({ service: 'restorna-api', store: 'postgres' });
    const repos = await buildPostgresRepos(process.env.DATABASE_URL, logger);
    const app = buildApiApp({ repos, logger });
    const server = createServer(app);
    // Seeding is owned by the SQL migrations for the Postgres path.
    return { ...app, server };
  }
  return await buildSeededApi(process.env.SEED_TENANT_ID || 'acme');
}

// node bff/api/src/build.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, logger } = await buildSeededApi('acme');
  const port = process.env.PORT || 8080;
  server.listen(port, () => logger.info('restorna-api.listening', { port }));
}
