// Composition root — wires concrete in-memory adapters to the identity use cases.
// Swap the repo/bus/outbox lines to move from in-memory to Postgres + NATS in prod.
import { systemClock } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';
import { InMemoryUserRepository } from './adapters/repos.js';
import { makeIdentityUseCases } from './application/usecases.js';

export function buildIdentityService({
  bus = new InMemoryEventBus(),
  outbox = new InMemoryOutbox(),
  clock = systemClock,
} = {}) {
  const users = new InMemoryUserRepository();
  const useCases = makeIdentityUseCases({ users, outbox });
  return { useCases, repos: { users }, bus, outbox };
}
