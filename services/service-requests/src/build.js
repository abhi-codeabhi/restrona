// Composition root — wires concrete in-memory adapters to the service-request use cases.
// Swap the repo/bus/outbox lines to move from in-memory to Postgres + NATS in prod.
import { systemClock } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';
import { InMemoryRequestRepository } from './adapters/repos.js';
import { makeServiceRequestUseCases } from './application/usecases.js';

export function buildServiceRequestsService({
  bus = new InMemoryEventBus(),
  outbox = new InMemoryOutbox(),
  clock = systemClock,
  settings = { escalationSecs: 30, cooldownSecs: 60 },
} = {}) {
  const requests = new InMemoryRequestRepository();
  const useCases = makeServiceRequestUseCases({ requests, outbox, clock, settings });
  return { useCases, repos: { requests }, bus, outbox };
}
