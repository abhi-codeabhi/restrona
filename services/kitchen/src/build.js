// Composition root — wires concrete in-memory adapters to the kitchen use cases.
// Swap the repo/bus/outbox lines to move from in-memory to Postgres + NATS in prod.
import { systemClock } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';
import { InMemoryTicketRepository } from './adapters/repos.js';
import { makeKitchenUseCases } from './application/usecases.js';

export function buildKitchenService({
  bus = new InMemoryEventBus(),
  outbox = new InMemoryOutbox(),
  clock = systemClock,
} = {}) {
  const tickets = new InMemoryTicketRepository();
  const useCases = makeKitchenUseCases({ tickets, outbox, clock });
  return { useCases, repos: { tickets }, bus, outbox };
}
