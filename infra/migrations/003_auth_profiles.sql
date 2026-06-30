-- ============================================================================
-- Restorna auth — per-persona OTP via Supabase Auth.
-- Run AFTER 002_saas_schema.sql in the Supabase SQL editor.
--
-- OTP itself is handled by Supabase Auth (email or phone). This script only maps
-- a verified auth user → their persona (role) + tenant + restaurant, by matching
-- the login email/phone against the staff/tenants tables. The app calls me()
-- after login to learn who it's talking to.
-- ============================================================================

create table if not exists user_profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  tenant_id     uuid references tenants(id) on delete cascade,
  restaurant_id uuid references restaurants(id) on delete set null,
  role          text,                       -- owner | manager | waiter | kitchen | billing
  staff_id      uuid references staff(id) on delete set null,
  created_at    timestamptz not null default now()
);

alter table user_profiles enable row level security;
drop policy if exists own_profile on user_profiles;
create policy own_profile on user_profiles
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- me(): resolve (and lazily create) the caller's profile from their auth identity.
-- security definer so it can read auth.users + staff/tenants and upsert the link.
create or replace function public.me()
returns table (role text, tenant_id uuid, restaurant_id uuid, owner_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_phone  text;
  v_tenant uuid;
  v_rest   uuid;
  v_role   text;
  v_staff  uuid;
begin
  if v_uid is null then return; end if;

  perform 1 from user_profiles where user_id = v_uid;
  if not found then
    select email, phone into v_email, v_phone from auth.users where id = v_uid;

    -- staff match (waiter / kitchen / billing / manager)
    select s.tenant_id, s.restaurant_id, s.role, s.id
      into v_tenant, v_rest, v_role, v_staff
      from staff s
      where s.active and (s.email = v_email or (v_phone is not null and s.phone = v_phone))
      limit 1;

    -- else owner match by the account email
    if not found then
      select t.id into v_tenant from tenants t where t.email = v_email limit 1;
      if found then v_role := 'owner'; v_rest := null; v_staff := null; end if;
    end if;

    if v_tenant is not null then
      insert into user_profiles (user_id, tenant_id, restaurant_id, role, staff_id)
        values (v_uid, v_tenant, v_rest, v_role, v_staff)
        on conflict (user_id) do update set
          tenant_id = excluded.tenant_id, restaurant_id = excluded.restaurant_id,
          role = excluded.role, staff_id = excluded.staff_id;
    end if;
  end if;

  return query
    select up.role, up.tenant_id, up.restaurant_id,
           (select owner_name from tenants t where t.id = up.tenant_id)
      from user_profiles up where up.user_id = v_uid;
end $$;

grant execute on function public.me() to authenticated;

-- ---------- demo emails so the seeded staff can log in via OTP ---------------
-- Owner already has aarav@restorna.co (from 002). Give the seeded waiters/managers
-- predictable emails to test each persona's login.
do $$
declare s record; i int := 0;
begin
  for s in
    select id, role, restaurant_id from staff
    where tenant_id = '11111111-1111-1111-1111-111111111111' and email is null
    order by restaurant_id, role, id
  loop
    i := i + 1;
    update staff set email = lower(replace(s.role,' ','')) || i || '@demo.restorna.co' where id = s.id;
  end loop;
end $$;

-- Verify: select email, role from staff where tenant_id='11111111-1111-1111-1111-111111111111';
