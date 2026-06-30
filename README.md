# Restorna — runnable foundation

This is a **real, runnable, tested foundation** for the Restorna platform, built in the exact
production shape from `Restorna_Architecture_Blueprint.md`. It implements the **core revenue loop
the blueprint says to build first** — the Ordering bounded context, including shared-table group
ordering + automatic bill split, multi-tenant isolation, and the event/outbox pattern — using a
clean **hexagonal architecture**.

It is **dependency-free** (Node 20+ built-ins only) so it runs and tests anywhere with zero install,
which matters because this sandbox blocks the npm registry. Every in-memory adapter maps 1:1 to its
production counterpart.

## Run it

```bash
node --version            # need >= 20
npm test                  # 14 tests across domain, use cases, and HTTP — all pass
npm run demo              # boots the service and drives the API end-to-end
npm start                 # serves the Ordering API on :3001
```

Example:

```bash
curl -s -X POST localhost:3001/orders \
  -H 'content-type: application/json' -H 'x-tenant-id: acme' \
  -d '{"tableId":"T12","items":[{"menuItemId":"paneer","unitPriceMinor":24000,"qty":1}]}'
```

## Layout (monorepo shape)

```
packages/
  core/        @restorna/core      — Result, Money, ids, errors, clock, logger (imports nothing)
  contracts/   @restorna/contracts — DTO validators + event schemas (single source of truth)
  tenancy/     @restorna/tenancy    — TenantContext (AsyncLocalStorage), resolution, cache keys
  events/      @restorna/events     — event bus + transactional outbox
services/        each a bounded context in the same hexagonal shape
                 (src/domain pure · src/application use-cases · src/adapters · test/):
  ordering/          orders, lifecycle, shared-table group ordering + split  (+ HTTP + composition root)
  catalog/           menu items, modifiers, dietary guardrails, 86 / availability, publish
  kitchen/           KDS tickets, item states, all-day rail, bump
  billing/           bills, tax/discount, split, payments, reconciliation
  promotions/        coupons, happy hour, scheduled — discount engine
  identity/          RBAC + ABAC, platform>owner>manager>staff hierarchy
  tenant/            control-plane: tenant provisioning (billable), plans, metering
  floor/             tables, statuses, waiter assignment, move / swap carrying orders
  crm/               guest profiles, visit history, digital chit, preferences
  service-requests/  waiter call, assigned-first escalation, ack rate-limit
```

All 10 services share the `@restorna/*` packages and run on `node --test` (78 tests, all passing).
Only `ordering` ships the HTTP adapter + composition root as the reference; the others expose the
same domain + use-case + adapter layers (HTTP/BFF wiring follows ordering's pattern).

The `#core`, `#contracts`, `#tenancy`, `#events` import aliases (in `package.json#imports`) stand in
for the published `@restorna/*` packages. In the real monorepo (Nx + pnpm) they become workspace
packages resolved by name.

## How this maps to production

| Reference (here) | Production |
|---|---|
| `InMemoryOrderRepository` (tenant-partitioned Map) | Postgres repo with RLS (T1) / schema (T2) / dedicated DB (T3) |
| `InMemoryEventBus` | NATS JetStream |
| `InMemoryOutbox.relayTo(bus)` | Postgres outbox table + CDC relay (at-least-once) |
| hand-rolled validators in `contracts` | Zod schemas that also emit OpenAPI/AsyncAPI + the SDK |
| Node `http` server | NestJS/Fastify controller calling the **same** use cases |
| `withTenant` (AsyncLocalStorage) | identical; resolution from a verified JWT `tid` claim |

Because the domain/application layers depend only on **ports**, swapping any adapter is a change at
the composition root — not a rewrite. That is the whole payoff of the hexagonal design.

## What this is NOT (honest scope)

This is the foundation, not the finished SaaS. Not included yet: the other bounded contexts
(Catalog, Fulfillment, Billing/Payments, Floor, CRM, Analytics, Tenant control-plane), the BFFs,
auth/RBAC enforcement, the connector framework, real Postgres/NATS adapters, infra, and the
front-end apps (the design lives in `Restorna_Prototype.html`). The blueprint's phased roadmap
(Phase 0 modular monolith → extract services) is how this grows into the full product.

## Next steps to extend

1. `node --test` stays green as you add code — write the test first.
2. Add a bounded context by copying `services/ordering`'s shape (domain → application → adapters).
3. Swap an adapter: implement a `PostgresOrderRepository` against the same methods, wire it in `main.js`.
4. Replace validators with Zod in `@restorna/contracts`; generate the SDK + OpenAPI from them.
5. Bring up `docker-compose.yml` (Postgres + Redis + NATS) and point the adapters at it.
