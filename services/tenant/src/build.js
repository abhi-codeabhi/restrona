// Composition root — wires concrete in-memory adapters to the tenant control-plane use cases.
// Swap the directory/bus/outbox lines to move from in-memory to Postgres + NATS in prod.
import { systemClock } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';
import { InMemoryTenantDirectory } from './adapters/repos.js';
import { makeTenantUseCases } from './application/usecases.js';

export function buildTenantService({
  bus = new InMemoryEventBus(),
  outbox = new InMemoryOutbox(),
  clock = systemClock,
} = {}) {
  const directory = new InMemoryTenantDirectory();
  const useCases = makeTenantUseCases({ directory, outbox, clock });
  return { useCases, repos: { directory }, bus, outbox };
}
