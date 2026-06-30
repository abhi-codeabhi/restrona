// Waiter BFF — inbound HTTP adapter over Node's built-in http (no framework dep).
// Mirrors the request/JSON/tenant/outbox patterns from services/ordering/src/adapters/http.js
// and bff/customer/src/server.js. Contains NO business rules: it only resolves the
// tenant, parses input, calls the composed use cases (floor + service-requests +
// ordering), maps AppError -> HTTP status, and relays the SHARED outbox to the bus.
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

  // ---- Floor ----
  if (m === 'GET' && path === '/floor') {
    return await uc.floor.getFloor(tenant);
  }
  if (m === 'POST' && path === '/tables/assign') {
    const body = (await readBody(req)) ?? {};
    return await uc.floor.assignWaiter(tenant, { n: body.n, waiterId: body.waiterId });
  }
  if (m === 'POST' && path === '/tables/move') {
    const body = (await readBody(req)) ?? {};
    // moveTable carries the order (move) or exchanges two tables (swap); the
    // domain throws DomainError for illegal moves, surfaced as the right status.
    return await uc.floor.moveTable(tenant, { srcN: body.srcN, dstN: body.dstN });
  }

  // ---- Service requests ----
  if (m === 'GET' && path === '/requests') {
    return await uc.serviceRequests.listOpen(tenant);
  }
  if (m === 'POST' && path === '/requests/escalate') {
    const body = (await readBody(req)) ?? {};
    return await uc.serviceRequests.escalateDue(tenant, { now: body.now ?? Date.now() });
  }
  if (m === 'POST' && (mt = path.match(/^\/requests\/([^/]+)\/ack$/))) {
    const body = (await readBody(req)) ?? {};
    return await uc.serviceRequests.acknowledge(tenant, { requestId: mt[1], now: body.now ?? Date.now() });
  }

  // ---- Orders (waiter taking an order) ----
  if (m === 'POST' && path === '/orders') {
    const body = await readBody(req);
    const r = await uc.ordering.placeOrder(tenant, body);
    return r.ok ? { ok: true, status: 201, value: r.value } : r;
  }

  send(res, 404, { code: 'NOT_FOUND', message: `No route for ${m} ${path}` });
  return undefined;
}
