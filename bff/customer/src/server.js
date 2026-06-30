// Customer BFF — inbound HTTP adapter over Node's built-in http (no framework dep).
// Mirrors the request/JSON/tenant/outbox patterns from services/ordering/src/adapters/http.js.
// Contains NO business rules: it only resolves the tenant, parses input, calls the
// composed use cases, maps AppError -> HTTP status, and relays the shared outbox.
import http from 'node:http';
import { AppError, UnauthorizedError } from '#core';
import { withTenant, resolveTenantFromHeaders } from '#tenancy';

function send(res, status, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(json);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve(null); } });
  });
}

export function createServer({ useCases, outbox, bus, logger }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/healthz') return send(res, 200, { status: 'ok' });

      const tenant = resolveTenantFromHeaders(req.headers);
      if (!tenant) throw new UnauthorizedError('Missing x-tenant-id header');

      await withTenant(tenant, async () => {
        const result = await route(req, res, path, url, tenant, useCases);
        if (result === undefined) return; // already handled (404)
        if (!result.ok) throw result.error;
        // relay outbox after a successful command (prod: CDC relay → NATS)
        const n = await outbox.relayTo(bus);
        if (n && logger) logger.info('events.published', { count: n });
        send(res, result.status ?? 200, result.value);
      });
    } catch (e) {
      const status = e instanceof AppError ? e.status : 500;
      send(res, status, e instanceof AppError ? e.toJSON() : { code: 'INTERNAL', message: 'Internal error' });
    }
  });
}

async function route(req, res, path, url, tenant, uc) {
  const m = req.method;
  let mt;

  // ---- Menu (catalog) ----
  if (m === 'GET' && path === '/menu') {
    const prefsRaw = url.searchParams.get('prefs');
    const prefs = prefsRaw ? prefsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    if (prefs.length === 0) {
      return await uc.catalog.getMenu(tenant);
    }
    const r = await uc.catalog.evaluateMenu(tenant, { prefs });
    if (!r.ok) return r;
    // evaluateMenu yields { item, ok, reasons }; expose `suitable` to the PWA.
    const items = r.value.map(({ item, ok, reasons }) => ({ item, suitable: ok, reasons }));
    return { ok: true, value: items };
  }

  // ---- Orders (ordering) ----
  if (m === 'POST' && path === '/orders') {
    const body = await readBody(req);
    const r = await uc.ordering.placeOrder(tenant, body);
    return r.ok ? { ok: true, status: 201, value: r.value } : r;
  }
  if (m === 'GET' && (mt = path.match(/^\/orders\/([^/]+)$/))) {
    return await uc.ordering.getOrder(tenant, mt[1]);
  }

  // ---- Shared-table sessions (ordering) ----
  if (m === 'POST' && path === '/sessions') {
    const r = await uc.ordering.openSession(tenant, await readBody(req));
    return r.ok ? { ok: true, status: 201, value: r.value } : r;
  }
  if (m === 'POST' && (mt = path.match(/^\/sessions\/([^/]+)\/items$/))) {
    return await uc.ordering.addSharedItem(tenant, mt[1], await readBody(req));
  }
  if (m === 'GET' && (mt = path.match(/^\/sessions\/([^/]+)\/split$/))) {
    return await uc.ordering.getSplit(tenant, mt[1], url.searchParams.get('mode') ?? 'by_item');
  }

  // ---- Checkout quote (promotions) ----
  if (m === 'POST' && path === '/checkout/quote') {
    const body = (await readBody(req)) ?? {};
    const subtotalMinor = body.subtotalMinor;
    const r = await uc.promotions.evaluate(tenant, {
      subtotalMinor,
      couponCode: body.couponCode ?? null,
      category: body.category ?? null,
    });
    if (!r.ok) return r;
    const discountMinor = r.value.discountMinor;
    return {
      ok: true,
      value: {
        subtotalMinor,
        discountMinor,
        applied: r.value.applied,
        totalMinor: subtotalMinor - discountMinor,
      },
    };
  }

  // ---- Service requests (service-requests) ----
  if (m === 'POST' && path === '/service-requests') {
    const body = (await readBody(req)) ?? {};
    return await uc.serviceRequests.raise(tenant, {
      type: body.type,
      table: body.table,
      assignedTo: body.assignedTo ?? null,
      now: Date.now(),
    });
  }

  send(res, 404, { code: 'NOT_FOUND', message: `No route for ${m} ${path}` });
  return undefined;
}
