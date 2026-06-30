// Composition root for the Waiter BFF.
// Wires the use cases of three bounded-context services — floor, service-requests,
// and ordering — around ONE shared InMemoryEventBus + InMemoryOutbox + systemClock,
// seeds demo data for tenant 'acme', and exposes the HTTP server. Contains NO
// business rules: orchestration only. Events from every composed service funnel
// into the single shared outbox that the server relays to the shared bus.
import { systemClock, createLogger } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';

import { makeFloorUseCases } from '../../../services/floor/src/application/usecases.js';
import { InMemoryFloorRepository } from '../../../services/floor/src/adapters/repos.js';

import { makeServiceRequestUseCases } from '../../../services/service-requests/src/application/usecases.js';
import { InMemoryRequestRepository } from '../../../services/service-requests/src/adapters/repos.js';

import { makeUseCases as makeOrderingUseCases } from '../../../services/ordering/src/application/usecases.js';
import { InMemoryOrderRepository, InMemorySessionRepository } from '../../../services/ordering/src/adapters/repos.js';

import { createServer } from './server.js';

// Build the wired use cases + shared infra, WITHOUT starting an HTTP listener.
// Returns everything tests need; the listening variant builds on top of this.
export function buildWaiterBffApp() {
  const logger = createLogger({ service: 'bff-waiter' });

  // ONE shared bus + outbox + clock across every composed service.
  const bus = new InMemoryEventBus();
  const outbox = new InMemoryOutbox();
  const clock = systemClock;

  // Repositories (one per aggregate; tenant-partitioned).
  const floor = new InMemoryFloorRepository();
  const requests = new InMemoryRequestRepository();
  const orders = new InMemoryOrderRepository();
  const sessions = new InMemorySessionRepository();

  // Use cases, each given the SHARED outbox/clock so events funnel into one outbox.
  const floorUC = makeFloorUseCases({ floor, outbox });
  const serviceRequests = makeServiceRequestUseCases({
    requests, outbox, clock,
    settings: { escalationSecs: 30, cooldownSecs: 60 },
  });
  const ordering = makeOrderingUseCases({ orders, sessions, outbox, clock });

  const useCases = { floor: floorUC, serviceRequests, ordering };

  return { useCases, bus, outbox, clock, logger, repos: { floor, requests, orders, sessions } };
}

// Seed demo data for a single tenant (default 'acme'): a floor with tables and a
// couple of seated tables. Use cases take the tenant explicitly, so no withTenant
// context is needed for seeding (it runs outside the HTTP request lifecycle).
export async function seedDemoData(useCases, tenantId = 'acme') {
  const tenant = { tenantId, tier: 'T1_POOLED', region: 'ap-mumbai-1' };

  await useCases.floor.initFloor(tenant, { tableNumbers: [12, 7, 3, 9, 5, 8] });
  // Seat a couple of tables, carrying a live order + waiter so move/swap has data.
  await useCases.floor.seatTable(tenant, { n: 12, order: 'ord_demo_1' });
  await useCases.floor.assignWaiter(tenant, { n: 12, waiterId: 'w_ramesh' });
  await useCases.floor.seatTable(tenant, { n: 7, order: 'ord_demo_2' });
  await useCases.floor.assignWaiter(tenant, { n: 7, waiterId: 'w_sita' });
}

// Full build: composition root + HTTP server, ready to listen (unseeded).
export function buildWaiterBff() {
  const { useCases, bus, outbox, clock, logger, repos } = buildWaiterBffApp();
  const server = createServer({ useCases, outbox, bus, logger });
  return { server, useCases, bus, outbox, clock, logger, repos };
}

// Test/helper variant: build + seed (awaited) + server, but do NOT listen.
export async function buildSeededWaiterBff(tenantId = 'acme') {
  const { useCases, bus, outbox, clock, logger, repos } = buildWaiterBffApp();
  await seedDemoData(useCases, tenantId);
  const server = createServer({ useCases, outbox, bus, logger });
  return { server, useCases, bus, outbox, clock, logger, repos };
}

// node bff/waiter/src/build.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, useCases, logger } = buildWaiterBff();
  await seedDemoData(useCases, 'acme');
  const port = process.env.PORT || 3011;
  server.listen(port, () => logger.info('bff-waiter.listening', { port }));
}
