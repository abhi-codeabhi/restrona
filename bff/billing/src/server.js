// Billing BFF — inbound HTTP adapter over Node's built-in http (no framework dep).
// Mirrors the request/JSON/tenant/outbox patterns from
// services/ordering/src/adapters/http.js and bff/customer/src/server.js.
// Contains NO business rules: it resolves the tenant, parses input, calls the
// composed billing + promotions use cases, maps AppError -> HTTP status, and
// relays the shared outbox.
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

  // ---- Bills (billing) ----
  if (m === 'POST' && path === '/bills') {
    const body = (await readBody(req)) ?? {};
    const r = await uc.billing.openBill(tenant, {
      orderId: body.orderId, table: body.table, lines: body.lines,
    });
    return r.ok ? { ok: true, status: 201, value: r.value } : r;
  }
  if (m === 'GET' && (mt = path.match(/^\/bills\/([^/]+)$/))) {
    return await uc.billing.getBill(tenant, mt[1]);
  }
  if (m === 'POST' && (mt = path.match(/^\/bills\/([^/]+)\/discount$/))) {
    const body = (await readBody(req)) ?? {};
    return await uc.billing.applyDiscount(tenant, mt[1], { minor: body.minor, reason: body.reason });
  }
  if (m === 'GET' && (mt = path.match(/^\/bills\/([^/]+)\/split$/))) {
    return await uc.billing.splitBill(tenant, mt[1], { mode: url.searchParams.get('mode') ?? 'by_item' });
  }
  if (m === 'POST' && (mt = path.match(/^\/bills\/([^/]+)\/payments$/))) {
    const body = (await readBody(req)) ?? {};
    const r = await uc.billing.recordPayment(tenant, mt[1], {
      method: body.method,
      amountMinor: body.amountMinor,
      tenderedMinor: body.tenderedMinor,
    });
    return r.ok ? { ok: true, status: 201, value: r.value } : r;
  }

  // ---- Promotions quote ----
  if (m === 'POST' && path === '/quote') {
    const body = (await readBody(req)) ?? {};
    const subtotalMinor = body.subtotalMinor;
    const r = await uc.promotions.evaluate(tenant, {
      subtotalMinor,
      couponCode: body.couponCode ?? null,
      category: body.category ?? null,
    });
    if (!r.ok) return r;
    return { ok: true, value: { discountMinor: r.value.discountMinor, applied: r.value.applied } };
  }

  send(res, 404, { code: 'NOT_FOUND', message: `No route for ${m} ${path}` });
  return undefined;
}
