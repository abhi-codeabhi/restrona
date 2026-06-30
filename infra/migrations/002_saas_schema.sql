-- ============================================================================
-- Restorna SaaS schema + seed — run in the Supabase SQL editor (one shot).
-- Creates: tenants (owners) → restaurants (logo + info) → staff + menu, all
-- multi-tenant with Row-Level Security. Seeds 1 owner, 2 restaurants, 3 waiters
-- each, and a mock menu per restaurant. Storage buckets for logo/menu uploads.
--
-- TENANCY: tenant_id = the owner's account id. The app sets it per request via
--   `select set_config('app.tenant_id', '<tenant-uuid>', true)` inside a tx, and
--   RLS scopes every row to that tenant. The SQL editor runs as a privileged role
--   that bypasses RLS, so this seed inserts freely.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- tables ----------------------------------------------------------
create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  owner_name  text not null,
  email       text,
  plan        text not null default 'growth',
  region      text not null default 'ap-mumbai-1',
  created_at  timestamptz not null default now()
);

create table if not exists restaurants (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  brand       text,
  logo_url    text,                       -- "add a logo": Supabase Storage public URL
  address     text,
  city        text,
  phone       text,
  currency    text not null default 'INR',
  gst_pct     numeric not null default 5,
  service_charge_pct numeric not null default 0,
  timezone    text not null default 'Asia/Kolkata',
  status      text not null default 'live',
  created_at  timestamptz not null default now()
);
create index if not exists restaurants_tenant on restaurants(tenant_id);

create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  restaurant_id uuid references restaurants(id) on delete cascade,
  name          text not null,
  role          text not null check (role in ('owner','manager','waiter','kitchen','billing')),
  email         text,
  phone         text,
  pin           text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists staff_tenant on staff(tenant_id);
create index if not exists staff_restaurant on staff(restaurant_id);

create table if not exists menu_categories (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists menu_categories_restaurant on menu_categories(restaurant_id);

create table if not exists menu_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  category_id   uuid references menu_categories(id) on delete set null,
  name          text not null,
  description   text,
  price_minor   int not null,             -- paise
  veg           boolean not null default true,
  tags          jsonb not null default '{}'::jsonb,   -- {dairy:1,nuts:1,...} for dietary guardrails
  prep_minutes  int,
  image_url     text,                     -- "upload menu": dish photo URL
  available     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists menu_items_restaurant on menu_items(restaurant_id);
create index if not exists menu_items_category on menu_items(category_id);

-- ---------- row-level security (tenant isolation) ---------------------------
do $$
declare t text;
begin
  foreach t in array array['tenants','restaurants','staff','menu_categories','menu_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    if t = 'tenants' then
      -- a tenant row is itself the boundary: match on id
      execute 'create policy tenant_isolation on tenants
                 using (id = current_setting(''app.tenant_id'', true)::uuid)
                 with check (id = current_setting(''app.tenant_id'', true)::uuid)';
    else
      execute format('create policy tenant_isolation on %I
                 using (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
                 with check (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
    end if;
  end loop;
end $$;

-- ---------- storage buckets for logo + menu image uploads -------------------
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true), ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

-- ============================================================================
-- SEED — 1 owner, 2 restaurants, 3 waiters each, mock menu per restaurant.
-- Fixed UUIDs so you can wire the app to them.
--   TENANT (owner) id : 11111111-1111-1111-1111-111111111111
--   Restaurant A id   : a1111111-1111-1111-1111-111111111111
--   Restaurant B id   : a2222222-2222-2222-2222-222222222222
-- Set the front-end VITE_TENANT_ID (and x-tenant-id) to the TENANT id above.
-- ============================================================================
insert into tenants (id, owner_name, email, plan, region) values
  ('11111111-1111-1111-1111-111111111111', 'Aarav Shah', 'aarav@restorna.co', 'growth', 'ap-mumbai-1')
on conflict (id) do nothing;

insert into restaurants (id, tenant_id, name, brand, logo_url, address, city, phone) values
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
     'Restorna Bandra', 'Restorna Fine Dining',
     'https://placehold.co/200x200?text=Restorna', 'Linking Road', 'Mumbai · Bandra', '+91 22 5550 1100'),
  ('a2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
     'Restorna Express BKC', 'Restorna Express',
     'https://placehold.co/200x200?text=Express', 'G Block, BKC', 'Mumbai · BKC', '+91 22 5550 2200')
on conflict (id) do nothing;

do $$
declare
  v_tenant uuid := '11111111-1111-1111-1111-111111111111';
  r        record;
  i        int;
  c_app uuid; c_main uuid; c_bread uuid; c_drink uuid; c_des uuid;
begin
  -- idempotent: clear this tenant's staff + menu before re-seeding
  delete from menu_items      where tenant_id = v_tenant;
  delete from menu_categories where tenant_id = v_tenant;
  delete from staff           where tenant_id = v_tenant;

  -- the owner, as a staff principal at the account level
  insert into staff (tenant_id, restaurant_id, name, role, email, active)
  values (v_tenant, null, 'Aarav Shah', 'owner', 'aarav@restorna.co', true);

  for r in select id, name from restaurants where tenant_id = v_tenant order by name loop
    -- 3 waiters per restaurant (+ a manager, kitchen, billing so it's operable)
    for i in 1..3 loop
      insert into staff (tenant_id, restaurant_id, name, role, pin, active)
      values (v_tenant, r.id, 'Waiter ' || i || ' · ' || r.name, 'waiter', lpad((1000+i)::text,4,'0'), true);
    end loop;
    insert into staff (tenant_id, restaurant_id, name, role, active) values
      (v_tenant, r.id, 'Manager · ' || r.name, 'manager', true),
      (v_tenant, r.id, 'Chef · ' || r.name, 'kitchen', true),
      (v_tenant, r.id, 'Cashier · ' || r.name, 'billing', true);

    -- menu categories
    insert into menu_categories (tenant_id, restaurant_id, name, sort_order) values (v_tenant, r.id, 'Appetizers', 1) returning id into c_app;
    insert into menu_categories (tenant_id, restaurant_id, name, sort_order) values (v_tenant, r.id, 'Mains', 2)      returning id into c_main;
    insert into menu_categories (tenant_id, restaurant_id, name, sort_order) values (v_tenant, r.id, 'Breads', 3)     returning id into c_bread;
    insert into menu_categories (tenant_id, restaurant_id, name, sort_order) values (v_tenant, r.id, 'Drinks', 4)     returning id into c_drink;
    insert into menu_categories (tenant_id, restaurant_id, name, sort_order) values (v_tenant, r.id, 'Desserts', 5)   returning id into c_des;

    -- mock menu items (price in paise)
    insert into menu_items (tenant_id, restaurant_id, category_id, name, description, price_minor, veg, tags, prep_minutes, sort_order) values
      (v_tenant, r.id, c_app,  'Crispy Corn Tikki',     'Golden sweetcorn fritters, mint chutney.',        16000, true,  '{"gluten":1}',                  12, 1),
      (v_tenant, r.id, c_app,  'Chilli Garlic Wings',   'Wok-tossed, sticky chilli-garlic glaze.',         28000, false, '{"meat":1,"spicy":1,"gluten":1}', 16, 2),
      (v_tenant, r.id, c_main, 'Paneer Tikka Bowl',     'Grilled paneer, jeera rice, burnt-garlic dal.',   24000, true,  '{"dairy":1}',                   14, 1),
      (v_tenant, r.id, c_main, 'Butter Chicken',        'Slow-cooked, tomato-cream gravy.',                34000, false, '{"meat":1,"dairy":1}',          18, 2),
      (v_tenant, r.id, c_main, 'Butter Fish Curry',     'Kerala-style coconut fish curry.',                38000, false, '{"fish":1,"spicy":1}',          20, 3),
      (v_tenant, r.id, c_bread,'Garlic Naan',           'Clay-oven naan, roasted garlic butter.',           6000, true,  '{"gluten":1,"dairy":1}',         6, 1),
      (v_tenant, r.id, c_bread,'Laccha Paratha',        'Flaky multi-layered whole-wheat.',                 7000, true,  '{"gluten":1}',                   7, 2),
      (v_tenant, r.id, c_drink,'Masala Lemonade',       'Fresh lime, black salt, soda.',                    9000, true,  '{}',                             3, 1),
      (v_tenant, r.id, c_drink,'Mango Lassi',           'Thick alphonso yoghurt blend.',                   12000, true,  '{"dairy":1,"sugar":1}',          3, 2),
      (v_tenant, r.id, c_des,  'Gulab Jamun (2 pc)',    'Warm, cardamom syrup.',                           11000, true,  '{"dairy":1,"gluten":1,"sugar":1}', 4, 1),
      (v_tenant, r.id, c_des,  'Dark Choc Lava Cake',   'Molten centre, vanilla scoop.',                   19000, true,  '{"dairy":1,"egg":1,"gluten":1,"sugar":1}', 8, 2);
  end loop;
end $$;

-- ---------- verify (optional) ----------------------------------------------
-- select (select count(*) from tenants)      as tenants,
--        (select count(*) from restaurants)  as restaurants,
--        (select count(*) from staff where role='waiter') as waiters,
--        (select count(*) from menu_items)   as menu_items;
