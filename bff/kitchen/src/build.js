// Composition root for the Kitchen BFF.
// Wires the use cases of the kitchen + catalog bounded-context services around
// ONE shared InMemoryEventBus + InMemoryOutbox + systemClock, seeds demo data for
// tenant 'acme', and exposes the HTTP server. Contains NO business rules.
import { systemClock, createLogger } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';

import { makeKitchenUseCases } from '../../../services/kitchen/src/application/usecases.js';
import { InMemoryTicketRepository } from '../../../services/kitchen/src/adapters/repos.js';

import { makeCatalogUseCases } from '../../../services/catalog/src/application/usecases.js';
import { InMemoryItemRepository } from '../../../services/catalog/src/adapters/repos.js';

import { createServer } from './server.js';

// Build the wired use cases + shared infra, WITHOUT starting an HTTP listener.
// Returns everything tests need; the listening variant builds on top of this.
export function buildKitchenBffApp() {
  const logger = createLogger({ service: 'bff-kitchen' });

  // ONE shared bus + outbox + clock across every composed service.
  const bus = new InMemoryEventBus();
  const outbox = new InMemoryOutbox();
  const clock = systemClock;

  // Repositories (one per aggregate; tenant-partitioned).
  const tickets = new InMemoryTicketRepository();
  const items = new InMemoryItemRepository();

  // Use cases, each given the shared outbox/clock so events funnel into one outbox.
  const kitchen = makeKitchenUseCases({ tickets, outbox, clock });
  const catalog = makeCatalogUseCases({ items, outbox, clock });

  const useCases = { kitchen, catalog };

  return { useCases, bus, outbox, clock, logger, repos: { tickets, items } };
}

// Seed demo data for a single tenant (default 'acme'): a few catalog items and
// two kitchen tickets fired onto the board.
export async function seedDemoData(useCases, tenantId = 'acme') {
  const tenant = { tenantId, tier: 'T1_POOLED', region: 'ap-mumbai-1' };

  // Catalog: a small menu so /menu/86 has something to toggle.
  await useCases.catalog.addItem(tenant, {
    name: 'Butter Chicken', priceMinor: 34000, veg: false, tags: { meat: 1, dairy: 1 },
  });
  await useCases.catalog.addItem(tenant, {
    name: 'Veg Biryani', priceMinor: 22000, veg: true, tags: { veg: 1 },
  });
  await useCases.catalog.addItem(tenant, {
    name: 'Garlic Naan', priceMinor: 6000, veg: true, tags: { veg: 1, gluten: 1, dairy: 1 },
  });

  // Kitchen: fire two tickets onto the board.
  await useCases.kitchen.receiveTicket(tenant, {
    orderId: 'ord-7',
    table: 'T7',
    items: [
      { name: 'Butter Chicken', station: 'grill' },
      { name: 'Veg Biryani', station: 'tandoor' },
    ],
  });
  await useCases.kitchen.receiveTicket(tenant, {
    orderId: 'ord-12',
    table: 'T12',
    items: [
      { name: 'Paneer Tikka', station: 'grill' },
      { name: 'Naan', station: 'tandoor' },
      { name: 'Naan', station: 'tandoor' },
    ],
  });
}

// Full build: composition root + HTTP server, ready to listen.
export function buildKitchenBff() {
  const { useCases, bus, outbox, clock, logger, repos } = buildKitchenBffApp();
  const server = createServer({ useCases, outbox, bus, logger });
  return { server, useCases, bus, outbox, clock, logger, repos };
}

// Test/helper variant: build + seed (awaited) + server, but do NOT listen.
export async function buildSeededKitchenBff(tenantId = 'acme') {
  const { useCases, bus, outbox, clock, logger, repos } = buildKitchenBffApp();
  await seedDemoData(useCases, tenantId);
  const server = createServer({ useCases, outbox, bus, logger });
  return { server, useCases, bus, outbox, clock, logger, repos };
}

// node bff/kitchen/src/build.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, useCases, logger } = buildKitchenBff();
  await seedDemoData(useCases, 'acme');
  const port = process.env.PORT || 3011;
  server.listen(port, () => logger.info('bff-kitchen.listening', { port }));
}
