# Deploy Restorna — front-end on Vercel, back-end on Render

Front-end (React PWA) → **Vercel**. Five BFFs (one container image) → **Render**. Optional DB → **Supabase**.

## 1. Push to GitHub (one-time)
```bash
cd restorna
git init && git add -A && git commit -m "Restorna" && git branch -M main
git remote add origin git@github.com:<you>/restorna.git   # SSH (see earlier auth notes)
git push -u origin main
```

## 2. Back-end on Render (Blueprint deploys all 5 BFFs)
1. render.com → **New → Blueprint** → pick the repo → **Apply**. `render.yaml` creates:
   `restorna-customer`, `-waiter`, `-kitchen`, `-billing`, `-owner` (same Docker image, different `APP`).
2. Leave `ALLOWED_ORIGIN` unset for now — it defaults to `*`, so the app works before you have a Vercel URL.
3. Note each service URL, e.g. `https://restorna-customer.onrender.com`. Sanity check:
   `curl https://restorna-customer.onrender.com/healthz`.

## 3. Front-end on Vercel
1. vercel.com → **New Project** → pick the repo.
2. Set **Root Directory = `frontend`** (important — the app lives there).
3. Add env vars (Project → Settings → Environment Variables), pointing at your Render URLs:
   ```
   VITE_CUSTOMER_API = https://restorna-customer.onrender.com
   VITE_WAITER_API   = https://restorna-waiter.onrender.com
   VITE_KITCHEN_API  = https://restorna-kitchen.onrender.com
   VITE_BILLING_API  = https://restorna-billing.onrender.com
   VITE_OWNER_API    = https://restorna-owner.onrender.com
   VITE_TENANT_ID    = acme
   ```
4. Deploy. Vercel auto-detects Vite (`npm run build` → `dist/`); `vercel.json` handles SPA routing.
   You get a URL like `https://restorna.vercel.app`. Open `/`, pick a surface.

## 3b. (Alternative) Front-end on Render instead of Vercel
You don't need Vercel — the blueprint also defines a **`restorna-web` Static Site** that builds the Vite
app and serves `dist/` from Render's CDN. When you Apply the Blueprint it's created alongside the BFFs.
Then: in the Render dashboard, set its build-time `VITE_*_API` vars to the five BFF URLs, and set each
BFF's `ALLOWED_ORIGIN` to the `restorna-web` URL. Everything lives in one Render account. (Vite env vars
are baked in at build time, so changing them requires a redeploy of `restorna-web`.)

## 4. Lock down CORS (after you know the front-end URL)
In Render, set `ALLOWED_ORIGIN` = your Vercel URL (e.g. `https://restorna.vercel.app`) on **each** of the
5 services → redeploy. Now only your front-end origin can call the BFFs. (Until you do this, `*` allows all.)

## 5. (Optional) Persistence with Supabase
Follow `DEPLOY_RENDER_SUPABASE.md`: create the project, run `infra/migrations/001_ordering_init.sql`,
set `DATABASE_URL` (transaction pooler) on `restorna-ordering` — wait, the ordering *service* isn't in the
blueprint by default; persistence today applies to the ordering paths reached via the customer BFF. To
persist there, set `DATABASE_URL` on `restorna-customer` too and verify locally first (the Postgres adapter
is written but unverified — see that doc).

## How it fits together
```
[Vercel: React PWA]  --HTTPS+CORS-->  [Render: 5 BFFs (one image, APP=…)]  -->  [Supabase Postgres]
  /customer  → VITE_CUSTOMER_API → restorna-customer
  /kitchen   → VITE_KITCHEN_API  → restorna-kitchen
  /waiter    → VITE_WAITER_API   → restorna-waiter
  /owner     → VITE_OWNER_API    → restorna-owner
```

## Honest notes
- The front-end couldn't be `npm`-built where it was authored; run `cd frontend && npm install && npm run dev`
  once to compile, and expect to nudge a few API field mappings on first contact with each live BFF.
- BFFs are in-memory by default (data resets on restart/redeploy) until you wire Postgres.
- Owner dashboard ops metrics (covers/revenue/stations) are illustrative until the Analytics service exists;
  the Menu-IQ list is real (from the catalog).
- Render free tier spins down when idle (first request after idle is slow); upgrade to "starter" for always-on.
