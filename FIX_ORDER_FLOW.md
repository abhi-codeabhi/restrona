# Fix: orders now flow customer → kitchen → waiter → billing

## What was actually broken
The deploy ran **five separate services**, each with its **own in-memory store**.
A customer order lived only in the customer service; the kitchen service was a
different process that only knew its two hardcoded demo tickets. They shared
nothing, and **nothing turned a placed order into a kitchen ticket or floor
update** — that saga never existed. So:

- orders never reached the kitchen or waiter,
- the kitchen board "kept refreshing" (the UI polls) but never changed,
- status never moved because no code moved it.

## What changed
1. **One unified API** (`APP=api`, `bff/api/`) runs every surface over a **single
   shared store + event bus**. One process, one source of truth.
2. **The order-flow saga** (`services/orchestration/src/saga.js`) — the missing
   brain:
   - `OrderPlaced` → creates a kitchen ticket **and** seats the table as `cooking`,
   - kitchen bump (`TicketReady`) → table goes `ready` (waiter's serve feed) **and**
     a bill is opened from the order (billing has live data).
3. **Durable Supabase path**: when `DATABASE_URL` is set, every aggregate persists
   in Postgres (`infra/migrations/004_oms_operational.sql`) and the catalog reads
   the owner's real `menu_items`. In-memory remains the zero-config demo default.
4. **Public URL is the diner app**: `/` now redirects to `/customer`. The persona
   picker moved to `/demo`.
5. **Fewer background calls**: the kitchen/waiter boards pause polling when the
   browser tab is hidden and refetch once on return.

Verified: 116 tests pass, plus a live HTTP run (place order → ticket appears →
floor `cooking` → bump → floor `ready` → bill `₹252.00`).

## Deploy (Render + Supabase)

### 1. Supabase — run migrations in order
SQL editor → run `001` → `002` → `003` → `004` from `infra/migrations/`.

### 2. Render — collapse to two services
Your old `restorna-customer/waiter/kitchen/billing/owner` services are obsolete.
Either re-sync the Blueprint (`render.yaml` now defines `restorna-api` +
`restorna-web`) or create one **Docker** web service manually:

- **restorna-api** (Docker, repo root)
  - `APP = api`
  - `ALLOWED_ORIGIN = https://restorna-web.onrender.com`
  - `DATABASE_URL = <Supabase pooler URL>` (Project Settings → Database →
    Connection pooling → **Transaction** mode). Leave unset to run the in-memory demo.
  - Delete the other four BFF services to stop paying/cold-starting them.

### 3. Render — front-end (`restorna-web`)
- `VITE_API_URL = https://restorna-api.onrender.com`  ← single value, all surfaces
- `VITE_TENANT_ID = acme` (in-memory demo) **or** your tenant UUID (Supabase path)
- Redeploy with **Clear build cache & deploy** (Vite bakes env at build time).

### 4. Smoke test
- Open `https://restorna-web.onrender.com/` → it should land on the **menu**.
- `/demo` → the persona launcher; open `/kitchen` and `/waiter` in other tabs.
- Place an order on `/customer` → within a few seconds it appears on the kitchen
  board and the table shows on the waiter floor. Bump it → waiter sees "ready".

## Note on the menu source
The in-memory API serves the seeded `acme` menu. With `DATABASE_URL` set, the
menu comes from your Supabase `menu_items` (the owner's uploaded menu), and
`VITE_TENANT_ID` must be that tenant's UUID. Rotate the Supabase password you
shared earlier if you haven't already.
