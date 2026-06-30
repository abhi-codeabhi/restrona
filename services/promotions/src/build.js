// Composition root — wires concrete in-memory adapters to the promotions use cases.
// Swap the repo/bus/outbox lines to move from in-memory to Postgres + NATS in prod.
import { systemClock } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';
import { InMemoryCouponRepository } from './adapters/repos.js';
import { makePromotionsUseCases } from './application/usecases.js';

export function buildPromotionsService({
  bus = new InMemoryEventBus(),
  outbox = new InMemoryOutbox(),
  clock = systemClock,
} = {}) {
  const coupons = new InMemoryCouponRepository();
  const useCases = makePromotionsUseCases({ coupons, outbox, clock });
  return { useCases, repos: { coupons }, bus, outbox };
}
