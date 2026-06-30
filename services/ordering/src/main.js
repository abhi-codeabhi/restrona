// Composition root — the ONLY place concrete adapters meet ports (Dependency Inversion).
// Swap these four lines to go from in-memory to Postgres + NATS in production.
import { systemClock, createLogger } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';
import { EVENTS } from '#contracts';
import { InMemoryOrderRepository, InMemorySessionRepository } from './adapters/repos.js';
import { makeUseCases } from './application/usecases.js';
import { createServer } from './adapters/http.js';

export function buildApp() {
  const logger = createLogger({ service: 'ordering' });
  const orders = new InMemoryOrderRepository();
  const sessions = new InMemorySessionRepository();
  const outbox = new InMemoryOutbox();
  const bus = new InMemoryEventBus();
  const clock = systemClock;

  // A downstream consumer (prod: a projector building a KDS read model).
  bus.subscribe(EVENTS.OrderPlaced, (e) =>
    logger.info('projector.order_placed', { tenantId: e.tenantId, orderId: e.payload.orderId }));

  const useCases = makeUseCases({ orders, sessions, outbox, clock });
  const server = createServer({ useCases, outbox, bus, logger });
  return { server, useCases, orders, sessions, outbox, bus, logger };
}

// node services/ordering/src/main.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, logger } = buildApp();
  const port = process.env.PORT || 3001;
  server.listen(port, () => logger.info('ordering.listening', { port }));
}
