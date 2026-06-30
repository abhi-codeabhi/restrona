// Composition root — the ONLY place concrete adapters meet ports (Dependency Inversion).
// Default = in-memory adapters (zero deps, used by tests). Set DATABASE_URL to run on
// Postgres/Supabase — buildAppFromEnv() then swaps in the Postgres adapter. Nothing else changes.
import { systemClock, createLogger } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';
import { EVENTS } from '#contracts';
import { InMemoryOrderRepository, InMemorySessionRepository } from './adapters/repos.js';
import { makeUseCases } from './application/usecases.js';
import { createServer } from './adapters/http.js';

export function buildApp({ orders, sessions } = {}) {
  const logger = createLogger({ service: 'ordering' });
  orders = orders ?? new InMemoryOrderRepository();
  sessions = sessions ?? new InMemorySessionRepository();
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

// Env-aware composition root used by the container launcher (bin/serve.js).
// In-memory by default; Postgres/Supabase when DATABASE_URL is present. `pg` is
// imported dynamically so the dependency-free path (and the test suite) never loads it.
export async function buildAppFromEnv() {
  if (!process.env.DATABASE_URL) return buildApp();
  const pgmod = await import('pg');
  const Pool = pgmod.Pool ?? pgmod.default?.Pool ?? pgmod.default;
  const { PostgresOrderRepository, PostgresSessionRepository } = await import('./adapters/postgresRepos.js');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  return buildApp({
    orders: new PostgresOrderRepository(pool),
    sessions: new PostgresSessionRepository(pool),
  });
}

// node services/ordering/src/main.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, logger } = await buildAppFromEnv();
  const port = process.env.PORT || 3001;
  server.listen(port, () => logger.info('ordering.listening', { port, db: !!process.env.DATABASE_URL }));
}
