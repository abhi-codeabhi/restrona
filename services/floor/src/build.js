// Composition root — wires concrete in-memory adapters to the floor use cases.
// Swap the repo/bus/outbox lines to move from in-memory to Postgres + NATS in prod.
import { systemClock } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';
import { InMemoryFloorRepository } from './adapters/repos.js';
import { makeFloorUseCases } from './application/usecases.js';

export function buildFloorService({
  bus = new InMemoryEventBus(),
  outbox = new InMemoryOutbox(),
  clock = systemClock,
} = {}) {
  const floor = new InMemoryFloorRepository();
  const useCases = makeFloorUseCases({ floor, outbox });
  return { useCases, repos: { floor }, bus, outbox };
}
