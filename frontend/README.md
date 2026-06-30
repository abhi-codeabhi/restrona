# Restorna front-end (React + Vite PWA)

Real front-end for the four Restorna surfaces, each a route that talks to its BFF.

## Run

```bash
cd frontend
npm install
cp .env.example .env       # point the VITE_*_API vars at your BFFs (local or Render)
npm run dev                # http://localhost:5173
```

Local backend: run the BFFs (`cd .. && docker compose up`, or `APP=customer PORT=8080 node bin/serve.js`)
and set `.env` accordingly. Then open `/`, pick a surface.

## Build & deploy (Vercel)

```bash
npm run build              # → dist/
```
Import the repo in Vercel (root = `frontend`), set the `VITE_*_API` env vars to your Render URLs.
`vercel.json` already rewrites all routes to `index.html` (SPA).

## Surfaces

| Route | Surface | BFF | Highlights |
|-------|---------|-----|------------|
| `/customer` | Customer PWA | customer-bff | menu + dietary guardrails, Add→stepper, cart, checkout quote (coupon), order, service bell, peak-end thank-you |
| `/kitchen` | Kitchen display | kitchen-bff | live board (3s poll), all-day rail, tap-to-advance, bump, aging escalation, "all caught up" |
| `/waiter` | Waiter handheld | waiter-bff | ranked "Now" feed (most-urgent isolated), floor map with move/swap |
| `/owner` | Owner console | (admin BFF pending) | insights dashboard + sparkline + station load, Menu-IQ quadrant |

## Architecture

- `src/lib/api.ts` — one `createClient(base)` per BFF; base URLs + tenant from env (12-factor).
- `src/styles/tokens.css` — the luxe design system (warm ivory + single brass accent) and shared classes.
- `src/surfaces/<role>/` — each surface owns its `api.ts` (endpoints) + component; no cross-surface imports.
- Design psychology is applied per surface (feedback animations, single-accent discipline, glanceable KDS,
  ranked waiter feed, signal-over-noise owner view, peak-end customer ending).

## Honest status

- **Not built/run in the environment it was authored in** (no npm/registry, no browser there). It is
  idiomatic React 18 + TS; run `npm install && npm run dev` to compile it. Expect to fix a few small
  field-name mismatches the first time you point a surface at its live BFF — the API normalizers in each
  `api.ts` are written defensively but the exact serialized shapes come from the services, so adjust there
  if a value reads as empty.
- **Owner** has no backend yet (no admin BFF). It renders the dashboard/Menu-IQ on seeded demo data and
  shows a note; wire it once the admin BFF exists.
- The **waiter "Serve"** action has no dedicated BFF route yet (acts locally; marked with a `// TODO`).
