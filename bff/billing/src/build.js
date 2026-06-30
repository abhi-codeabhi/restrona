// Composition root for the Billing BFF.
// Wires the use cases of the billing + promotions bounded-context services around
// ONE shared InMemoryEventBus + InMemoryOutbox + systemClock, seeds demo data for
// tenant 'acme', and exposes the HTTP server. Contains NO business rules.
import { systemClock, createLogger } from '#core';
import { InMemoryEventBus, InMemoryOutbox } from '#events';

import { makeBillingUseCases } from '../../../services/billing/src/application/usecases.js';
import { InMemoryBillRepository } from '../../../services/billing/src/adapters/repos.js';

import { makePromotionsUseCases } from '../../../services/promotions/src/application/usecases.js';
import { InMemoryCouponRepository } from '../../../services/promotions/src/adapters/repos.js';

import { createServer } from './server.js';

// Build the wired use cases + shared infra, WITHOUT starting an HTTP listener.
// Returns everything tests need; the listening variant builds on top of this.
export function buildBillingBffApp() {
  const logger = createLogger({ service: 'bff-billing' });

  // ONE shared bus + outbox + clock across every composed service.
  const bus = new InMemoryEventBus();
  const outbox = new InMemoryOutbox();
  const clock = systemClock;

  // Repositories (one per aggregate; tenant-partitioned).
  const bills = new InMemoryBillRepository();
  const coupons = new InMemoryCouponRepository();

  // Use cases, each given the shared outbox/clock so events funnel into one outbox.
  const billing = makeBillingUseCases({ bills, outbox, clock });
  const promotions = makePromotionsUseCases({ coupons, outbox, clock });

  const useCases = { billing, promotions };

  return { useCases, bus, outbox, clock, logger, repos: { bills, coupons } };
}

// Seed demo data for a single tenant (default 'acme'): one coupon + one demo bill.
// Returns the seeded demo bill so callers/tests can reference its id.
export async function seedDemoData(useCases, tenantId = 'acme') {
  const tenant = { tenantId, tier: 'T1_POOLED', region: 'ap-mumbai-1' };

  await useCases.promotions.createCoupon(tenant, {
    code: 'WELCOME20', type: 'percent', value: 20, minOrderMinor: 30000,
  });

  // Open one demo bill for Table 12 with a couple of lines, attributed to two
  // guests so a by_item split returns per-participant amounts.
  const r = await useCases.billing.openBill(tenant, {
    orderId: 'demo-order-1',
    table: 'Table 12',
    lines: [
      { name: 'Paneer Tikka Bowl', priceMinor: 24000, participantId: 'g1' },
      { name: 'Butter Chicken', priceMinor: 34000, participantId: 'g2' },
    ],
  });

  return r.ok ? r.value.bill : null;
}

// Full build: composition root + HTTP server, ready to listen.
export function buildBillingBff() {
  const { useCases, bus, outbox, clock, logger, repos } = buildBillingBffApp();
  const server = createServer({ useCases, outbox, bus, logger });
  return { server, useCases, bus, outbox, clock, logger, repos };
}

// Test/helper variant: build + seed (awaited) + server, but do NOT listen.
export async function buildSeededBillingBff(tenantId = 'acme') {
  const { useCases, bus, outbox, clock, logger, repos } = buildBillingBffApp();
  const demoBill = await seedDemoData(useCases, tenantId);
  const server = createServer({ useCases, outbox, bus, logger });
  return { server, useCases, bus, outbox, clock, logger, repos, demoBill };
}

// node bff/billing/src/build.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, useCases, logger } = buildBillingBff();
  await seedDemoData(useCases, 'acme');
  const port = process.env.PORT || 3011;
  server.listen(port, () => logger.info('bff-billing.listening', { port }));
}
