# Deploy Restorna — Supabase (database) + Render (backend)

Two phases. **Phase 1** gets a live public URL in ~10 minutes (in-memory data — great for a demo).
**Phase 2** adds Supabase persistence. Do them in order.

---

## Phase 0 — Push the repo to GitHub (one-time)

Render and Supabase both pull from a Git repo.

```bash
cd restorna
rm -rf .git
git init && git add -A && git commit -m "Restorna platform"
git branch -M main
gh repo create restorna --private --source=. --remote=origin --push
# or: git remote add origin git@github.com:<you>/restorna.git && git push -u origin main
```

---

## Phase 1 — Deploy the backend to Render (in-memory, live URL)

1. Go to **render.com** → sign in with GitHub.
2. **New → Blueprint** → pick your `restorna` repo. Render reads `render.yaml` and proposes 4 web
   services: `restorna-customer`, `-waiter`, `-kitchen`, `-billing`.
3. Click **Apply**. Render builds the Docker image and deploys each (the app is dependency-free, so
   the build is fast). For a demo you can delete all but `restorna-customer`.
4. When live, each service has a URL like `https://restorna-customer.onrender.com`.
   Test it:
   ```bash
   curl https://restorna-customer.onrender.com/healthz
   curl -H "x-tenant-id: acme" https://restorna-customer.onrender.com/menu
   ```
   You'll get the seeded menu back. Done — the backend is live.

> Free plan note: free services spin down after inactivity (first request after idle is slow).
> Upgrade the plan to "starter" in the dashboard for always-on.

---

## Phase 2 — Add Supabase persistence

### 2a. Create the database
1. Go to **supabase.com** → **New project**. Pick a region near you (e.g. Mumbai), set a DB password.
2. Open **SQL Editor → New query**, paste the contents of `infra/migrations/001_ordering_init.sql`,
   and **Run**. This creates the `orders`, `order_lines`, `sessions`, `outbox` tables **with
   row-level security** — that RLS is your tenant isolation.
3. **Project Settings → Database → Connection string → "Transaction" pooler** (port **6543**).
   Copy the URI and insert your password. This pooler URL is the one to use on Render/serverless;
   prepared statements are disabled on it (the adapter is written accordingly).

### 2b. The Postgres adapter is already wired — just provide DATABASE_URL
This is done in the code now (you don't edit anything):
- `package.json` declares the `pg` dependency; the `Dockerfile` runs `npm install --omit=dev`.
- `services/ordering/src/main.js` exposes `buildAppFromEnv()`: if `DATABASE_URL` is set it builds a
  `pg` Pool and uses `PostgresOrderRepository`/`PostgresSessionRepository`; otherwise it stays
  in-memory. `bin/serve.js` already calls `buildAppFromEnv()` for the ordering app.
- The `pg` import is dynamic, so the in-memory path and the test suite never load it.

**Verify locally against the real DB once before trusting persistence** (this adapter has not yet
been executed against a database):
```bash
npm install                                  # installs pg
DATABASE_URL="<your-supabase-pooler-uri>" PORT=3001 APP=ordering node bin/serve.js
# in another shell:
curl -s -X POST localhost:3001/orders -H 'content-type: application/json' -H 'x-tenant-id: <a-uuid>' \
  -d '{"tableId":"T12","items":[{"menuItemId":"paneer","unitPriceMinor":24000,"qty":1}]}'
# then confirm the row appears in Supabase → Table editor → orders
```
Note: tenant IDs must be UUIDs (the RLS column is `uuid`); use a real tenant UUID in `x-tenant-id`.
The other services/BFFs remain in-memory until their own Postgres adapters are added (same pattern).

### 2c. Tell Render about the database
1. In the Render dashboard, open each service → **Environment** → set `DATABASE_URL` to the Supabase
   transaction-pooler URI (it's marked `sync:false` in the blueprint, so it's a per-service secret).
2. Trigger a redeploy. Orders now persist in Supabase, scoped per tenant by RLS.

---

## Front-end (optional)

The customer PWA / staff apps (currently `Restorna_Prototype.html`, later a real app) deploy to
**Vercel** and call these Render URLs. Set the BFF base URL as a Vercel env var. Vercel is for the
front-end only — the BFFs stay on Render because they're long-lived servers.

---

## Honest status

- Phase 1 is fully real and works as written.
- Phase 2's Postgres adapter + SQL are written but **not yet executed against a database** (couldn't
  be, where this was built) — verify step 2b before relying on persistence.
- `app.tenant_id` for RLS is set per request from the tenant context; in production resolve it from a
  verified JWT `tid` claim (see `SUPABASE.md`).
