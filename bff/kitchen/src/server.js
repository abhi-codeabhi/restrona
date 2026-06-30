// Kitchen BFF — inbound HTTP adapter over Node's built-in http (no framework dep).
// Mirrors the request/JSON/tenant/outbox patterns from
// services/ordering/src/adapters/http.js and bff/customer/src/server.js.
// Contains NO business rules: it resolves the tenant, parses input, calls the
// composed kitchen + catalog use cases, maps AppError -> HTTP status, and relays
// the shared outbox.
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

  // ---- Kitchen board (KDS) ----
  if (m === 'GET' && path === '/board') {
    return await uc.kitchen.getBoard(tenant);
  }

  // ---- All-day rail: counts of not-yet-ready items ----
  if (m === 'GET' && path === '/all-day') {
    const r = await uc.kitchen.allDay(tenant);
    if (!r.ok) return r;
    // allDayCounts yields a Map(itemName -> count); expose a plain object to the KDS.
    return { ok: true, value: Object.fromEntries(r.value) };
  }

  // ---- Receive a fired ticket onto the board ----
  if (m === 'POST' && path === '/tickets/receive') {
    const body = (await readBody(req)) ?? {};
    const r = await uc.kitchen.receiveTicket(tenant, {
      orderId: body.orderId,
      table: body.table,
      items: body.items,
    });
    return r.ok ? { ok: true, status: 201, value: r.value } : r;
  }

  // ---- Advance one item new -> preparing -> ready ----
  if (m === 'POST' && (mt = path.match(/^\/tickets\/([^/]+)\/advance$/))) {
    const body = (await readBody(req)) ?? {};
    return await uc.kitchen.advanceItem(tenant, { ticketId: mt[1], itemIndex: body.itemIndex });
  }

  // ---- Bump the whole ticket to ready ----
  if (m === 'POST' && (mt = path.match(/^\/tickets\/([^/]+)\/bump$/))) {
    return await uc.kitchen.markAllReady(tenant, { ticketId: mt[1] });
  }

  // ---- "86" a menu item (toggle availability) ----
  if (m === 'POST' && path === '/menu/86') {
    const body = (await readBody(req)) ?? {};
    return await uc.catalog.toggleAvailability(tenant, {
      itemId: body.itemId,
      available: body.available,
    });
  }

  send(res, 404, { code: 'NOT_FOUND', message: `No route for ${m} ${path}` });
  return undefined;
}
