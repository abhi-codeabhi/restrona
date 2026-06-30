-- 004_oms_operational.sql
-- Durable operational store for the unified Restorna API (orders, kitchen tickets,
-- floor, bills, coupons, service-requests). Each aggregate is a JSONB document
-- keyed by its app id, with a tenant_id column for Row-Level Security. The catalog
-- is NOT here — it reads the real `menu_items` table from 002_saas_schema.sql so
-- the customer sees the owner's uploaded menu.
--
-- Multi-tenancy (tier T1): every row carries tenant_id; RLS scopes each statement
-- to current_setting('app.tenant_id'), which the API sets per transaction via
-- set_config(...) (transaction-mode pooler safe).
--
-- Run order: 001 -> 002 -> 003 -> 004.

-- ---------- generic document tables -----------------------------------------
create table if not exists oms_orders   (id text primary key, tenant_id uuid not null, doc jsonb not null, updated_at timestamptz not null default now());
create table if not exists oms_sessions (id text primary key, tenant_id uuid not null, doc jsonb not null, updated_at timestamptz not null default now());
create table if not exists oms_tickets  (id text primary key, tenant_id uuid not null, doc jsonb not null, updated_at timestamptz not null default now());
create table if not exists oms_floor    (id text primary key, tenant_id uuid not null, doc jsonb not null, updated_at timestamptz not null default now());
create table if not exists oms_bills    (id text primary key, tenant_id uuid not null, doc jsonb not null, updated_at timestamptz not null default now());
create table if not exists oms_coupons  (id text primary key, tenant_id uuid not null, doc jsonb not null, updated_at timestamptz not null default now());
create table if not exists oms_requests (id text primary key, tenant_id uuid not null, doc jsonb not null, updated_at timestamptz not null default now());

-- per-tenant cooldown store for the waiter-call rate limit
create table if not exists oms_request_cooldowns (
  tenant_id   uuid not null,
  k           text not null,            -- `${table}:${type}`
  last_ack_at bigint not null,          -- epoch ms
  primary key (tenant_id, k)
);

-- helpful tenant-scoped read indexes
create index if not exists oms_orders_tenant   on oms_orders(tenant_id);
create index if not exists oms_tickets_tenant  on oms_tickets(tenant_id);
create index if not exists oms_bills_tenant     on oms_bills(tenant_id);
create index if not exists oms_requests_tenant  on oms_requests(tenant_id);

-- ---------- row-level security (tenant isolation) ---------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'oms_orders','oms_sessions','oms_tickets','oms_floor',
    'oms_bills','oms_coupons','oms_requests','oms_request_cooldowns'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  end loop;
end $$;

-- The API connects as a role that must obey RLS. The Supabase `postgres`/service
-- role bypasses RLS by default; the app should use a non-superuser role in prod.
-- For the pooled connection used here, RLS is enforced because we never run as a
-- BYPASSRLS role from the API.
