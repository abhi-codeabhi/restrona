// Composition root — wires concrete in-memory adapters to the CRM/loyalty use cases.
// Swap the repo/bus/outbox lines to move from in-memory to Postgres + NATS in prod.
import { systemClock } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';
import { InMemoryGuestRepository } from './adapters/repos.js';
import { makeCrmUseCases } from './application/usecases.js';

export function buildCrmService({
  bus = new InMemoryEventBus(),
  outbox = new InMemoryOutbox(),
  clock = systemClock,
} = {}) {
  const guests = new InMemoryGuestRepository();
  const useCases = makeCrmUseCases({ guests, outbox, clock });
  return { useCases, repos: { guests }, bus, outbox };
}
