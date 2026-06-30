#!/usr/bin/env node
// Generic, cloud-agnostic launcher for the Restorna platform.
//
// One container image, one entrypoint. The APP env var selects which app this
// instance runs; PORT selects the listen port. For each BFF we use the SEEDED,
// no-listen builder (buildSeeded<App>Bff) so demo data is present, then call
// server.listen(PORT) ourselves. For the ordering service we use buildApp().
//
// Uses only Node built-ins — the platform is intentionally dependency-free.

import http from 'node:http';

const APP = (process.env.APP || 'customer').trim();
const PORT = Number(process.env.PORT || 8080);
// CORS: allow the front-end origin (Vercel). Set ALLOWED_ORIGIN to your Vercel URL
// in production; defaults to '*' for easy first-boot/local dev.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// Map each APP to the module to import and the function that yields a NOT-yet
// listening http.Server (seeded where a seeded builder exists).
const APPS = {
  customer: {
    module: '../bff/customer/src/build.js',
    build: (m) => m.buildSeededCustomerBff(),
  },
  waiter: {
    module: '../bff/waiter/src/build.js',
    build: (m) => m.buildSeededWaiterBff(),
  },
  kitchen: {
    module: '../bff/kitchen/src/build.js',
    build: (m) => m.buildSeededKitchenBff(),
  },
  billing: {
    module: '../bff/billing/src/build.js',
    build: (m) => m.buildSeededBillingBff(),
  },
  ordering: {
    module: '../services/ordering/src/main.js',
    // Env-aware: in-memory by default, Postgres/Supabase when DATABASE_URL is set.
    build: (m) => m.buildAppFromEnv(),
  },
  owner: {
    module: '../bff/owner/src/build.js',
    build: (m) => m.buildSeededOwnerBff(),
  },
};

// Wrap a BFF's request handler with CORS so a browser app on another origin
// (the Vercel front-end) can call it. Applied once here for every app.
function withCors(inner) {
  const handler = inner.listeners('request')[0];
  return http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-tenant-id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    handler(req, res);
  });
}

async function main() {
  const entry = APPS[APP];
  if (!entry) {
    process.stderr.write(
      `[serve] unknown APP="${APP}". Valid values: ${Object.keys(APPS).join(', ')}\n`,
    );
    process.exit(1);
  }

  const mod = await import(new URL(entry.module, import.meta.url));
  const built = await entry.build(mod);
  const inner = built && built.server;

  if (!inner || typeof inner.listen !== 'function') {
    process.stderr.write(`[serve] builder for APP="${APP}" did not return an http.Server\n`);
    process.exit(1);
  }

  // CORS-wrap so the Vercel front-end can call this BFF cross-origin.
  const server = withCors(inner);

  server.listen(PORT, () => {
    // Structured, single-line log.
    process.stdout.write(
      JSON.stringify({
        evt: 'serve.listening',
        app: APP,
        port: PORT,
        pid: process.pid,
        ts: new Date().toISOString(),
      }) + '\n',
    );
  });

  // Graceful shutdown on container stop signals.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(
      JSON.stringify({ evt: 'serve.shutdown', app: APP, signal, ts: new Date().toISOString() }) + '\n',
    );
    server.close(() => process.exit(0));
    // Safety net: force-exit if close() hangs.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  process.stderr.write(`[serve] fatal: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
