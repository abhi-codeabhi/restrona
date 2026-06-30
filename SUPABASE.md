# Supabase / Postgres deployable slice — Ordering context

> **Not verified in this environment.** The reference sandbox has no Postgres
> and cannot install npm packages, so the SQL and `pg`-based adapters below were
> written carefully but **not run**. Verify against a real Supabase project /
> Postgres database before relying on them.

This is the **tier T1** deployment of the Ordering bounded context: a single
shared Postgres schema where tenants are isolated by **Row-Level Security**.

## 1. Create a Supabase project

1. Create a project at <https://supabase.com> (pick a region close to users,
   e.g. ap-south for Mumbai).
2. Grab the connection strings from **Project Settings → Database**:
   - **Transaction pooler** (Supavisor, port `6543`) → `DATABASE_URL`
   - **Direct connection** (port `5432`) → `DIRECT_URL`
3. Copy `.env.example` to `.env` and fill both in.

## 2. Run the migration

Open the **SQL Editor** in the Supabase dashboard and run
[`infra/migrations/001_ordering_init.sql`](infra/migrations/001_ordering_init.sql)
(or `psql "$DIRECT_URL" -f infra/migrations/001_ordering_init.sql`).

It creates `orders`, `order_lines`, `sessions`, and `outbox`, with indexes and
RLS policies.

## 3. The RLS / tenant-isolation model (tier T1)

- Every table has RLS **enabled and forced**, with a `tenant_isolation` policy:
  `tenant_id = current_setting('app.tenant_id')::uuid` for both `USING` and
  `WITH CHECK`.
- The app connects as a **non-superuser, non-`BYPASSRLS` role** and, at the
  start of each transaction, runs the equivalent of
  `SET LOCAL app.tenant_id = '<uuid>'`
  (the adapters use `SELECT set_config('app.tenant_id', $1, true)` so the value
  can be parameterized). RLS then scopes every statement to that tenant.
- Because Supabase's pooler runs in **transaction mode**, the setting **must**
  be `LOCAL` (transaction-scoped) — a session-scoped `SET` would leak onto the
  next request that reuses the pooled backend.
- Derive the tenant id from the **verified JWT `tid` claim** per request (the
  existing `resolveTenantFromHeaders` helper reads `x-tenant-id`; in production
  that header is populated from the validated JWT, never trusted from the
  client directly).

## 4. Pooler / serverless notes

- Use the **port 6543 transaction pooler** URL (`DATABASE_URL`) for the running
  service and any serverless/edge functions.
- **Disable prepared statements** on the pooler. `node-postgres` defaults to the
  simple query protocol (no prepared statements), so it works as written; if you
  turn on prepared statements you must add the driver's disable flag or you'll
  hit `prepared statement "..." already exists`.
- Use the **port 5432 direct** URL (`DIRECT_URL`) for migrations.

## 5. Swap the in-memory repo for Postgres (composition-root change only)

This is the whole point of the ports/adapters layout: **only the composition
root changes**. In [`services/ordering/src/main.js`](services/ordering/src/main.js):

```js
import pg from 'pg';
import { PostgresOrderRepository, PostgresSessionRepository } from './adapters/postgresRepos.js';
import { PostgresOutbox } from './adapters/postgresOutbox.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const orders   = new PostgresOrderRepository(pool);
const sessions = new PostgresSessionRepository(pool);
const outbox   = new PostgresOutbox(pool);
```

…replacing the three `InMemory*` lines. The use cases, domain, and HTTP layer
are untouched because the port signatures
(`save(tenant, x)` / `findById(tenant, id)` / `list(tenant)`) are identical.

> Note: `makeUseCases` calls `outbox.add(envelope)` synchronously today. The
> `PostgresOutbox.add()` is `async`; either `await` it, or (better) thread the
> repo's transaction `client` into `add(evt, client)` so the event row commits
> in the same transaction as the business write. That is a small use-case
> change, not a domain change.

## 6. Outbox relay

`outbox` rows are published by polling `PostgresOutbox.relayPending(bus, tenant)`
from a background worker or **`pg_cron`** job. It selects unpublished rows
(`FOR UPDATE SKIP LOCKED` so multiple workers are safe), publishes each to the
bus, and stamps `published_at`. Delivery is at-least-once → consumers must be
idempotent.

## 7. Live updates (KDS / floor)

**Supabase Realtime** can replace the in-memory `EventBus` for live Kitchen
Display and floor screens: subscribe clients to Postgres changes on `orders` /
`outbox` (or broadcast on relay) instead of polling. The relay would publish to
a Realtime channel, keeping the bus interface (`publish(evt)`) intact.

---

**Honest status:** none of this has been executed against a real database in
this environment — it needs a real Postgres/Supabase instance with `pg`
installed to verify.
