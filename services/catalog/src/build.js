// Composition root — wires concrete in-memory adapters to the catalog use cases.
// Swap the repo/bus/outbox lines to move from in-memory to Postgres + NATS in prod.
import { systemClock } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';
import { InMemoryItemRepository } from './adapters/repos.js';
import { makeCatalogUseCases } from './application/usecases.js';

export function buildCatalogService({
  bus = new InMemoryEventBus(),
  outbox = new InMemoryOutbox(),
  clock = systemClock,
} = {}) {
  const items = new InMemoryItemRepository();
  const useCases = makeCatalogUseCases({ items, outbox, clock });
  return { useCases, repos: { items }, bus, outbox };
}
