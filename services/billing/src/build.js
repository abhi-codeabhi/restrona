// Composition root — wires concrete in-memory adapters to the billing use cases.
// Swap the repo/bus/outbox lines to move from in-memory to Postgres + NATS in prod.
import { systemClock } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';
import { InMemoryBillRepository } from './adapters/repos.js';
import { makeBillingUseCases } from './application/usecases.js';

export function buildBillingService({
  bus = new InMemoryEventBus(),
  outbox = new InMemoryOutbox(),
  clock = systemClock,
} = {}) {
  const bills = new InMemoryBillRepository();
  const useCases = makeBillingUseCases({ bills, outbox, clock });
  return { useCases, repos: { bills }, bus, outbox };
}
