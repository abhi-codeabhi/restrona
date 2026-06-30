-- 001_ordering_init.sql — Ordering bounded-context schema (Supabase / Postgres).
--
-- NOT-YET-VERIFIED: authored against the reference sandbox which has NO Postgres.
-- Run this in the Supabase SQL editor (or `psql`) against a real database to verify.
--
-- Multi-tenancy = tier T1 (pooled, shared schema) with Row-Level Security.
-- The application connects as a NON-SUPERUSER role that does NOT have the
-- BYPASSRLS attribute, and runs `SET LOCAL app.tenant_id = '<uuid>'` at the
-- start of every transaction. Because Supabase puts the connection pooler
-- (Supavisor) in TRANSACTION mode, settings must be scoped with SET LOCAL so
-- they live exactly as long as the transaction that owns the pooled backend.
-- RLS then transparently scopes every read/write to that tenant.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists orders (
  id            text primary key,
  tenant_id     uuid        not null,
  table_id      text,
  session_id    text,
  placed_by     text,
  status        text        not null default 'PENDING',
  subtotal_minor integer    not null default 0,
  currency      text        not null default 'INR',
  created_at    timestamptz not null default now()
);

create table if not exists order_lines (
  id              text primary key,
  order_id        text        not null references orders (id) on delete cascade,
  tenant_id       uuid        not null,
  menu_item_id    text        not null,
  name            text        not null,
  qty             integer     not null,
  unit_price_minor integer    not null
);

-- Shared-table sessions (group ordering / bill split) are document-shaped, so
-- they are stored as a single JSONB blob (see PostgresSessionRepository).
create table if not exists sessions (
  id         text primary key,
  tenant_id  uuid        not null,
  doc        jsonb       not null,
  created_at timestamptz not null default now()
);

-- Transactional outbox: business write + event row commit in ONE transaction;
-- a relay/worker (or pg_cron) later publishes unpublished rows to the bus.
create table if not exists outbox (
  id           bigserial   primary key,
  tenant_id    uuid        not null,
  aggregate    text        not null,
  type         text        not null,
  payload      jsonb       not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists orders_tenant_idx        on orders (tenant_id);
create index if not exists orders_tenant_status_idx  on orders (tenant_id, status);
create index if not exists order_lines_tenant_idx    on order_lines (tenant_id);
create index if not exists order_lines_order_idx     on order_lines (order_id);
create index if not exists sessions_tenant_idx       on sessions (tenant_id);
create index if not exists outbox_tenant_idx         on outbox (tenant_id);
-- Fast lookup of pending rows for the relay (only unpublished rows are indexed).
create index if not exists outbox_unpublished_idx
  on outbox (created_at)
  where published_at is null;

-- ---------------------------------------------------------------------------
-- Row-Level Security — tenant isolation (T1)
-- ---------------------------------------------------------------------------
-- ENABLE makes RLS apply to ordinary roles; FORCE makes it apply even to the
-- table owner, so a compromised/owner connection cannot read across tenants.

alter table orders      enable row level security;
alter table orders      force  row level security;
alter table order_lines enable row level security;
alter table order_lines force  row level security;
alter table sessions    enable row level security;
alter table sessions    force  row level security;
alter table outbox      enable row level security;
alter table outbox      force  row level security;

-- USING controls which existing rows are visible (SELECT/UPDATE/DELETE);
-- WITH CHECK controls which new/changed rows are allowed (INSERT/UPDATE).
-- Both pin the row's tenant_id to the per-transaction app.tenant_id GUC.

create policy tenant_isolation on orders
  using      (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

create policy tenant_isolation on order_lines
  using      (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

create policy tenant_isolation on sessions
  using      (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

create policy tenant_isolation on outbox
  using      (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
