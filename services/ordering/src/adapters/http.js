// Inbound adapter — HTTP API over Node's built-in http (no framework dep).
// Prod: this is a NestJS/Fastify controller. The handlers below call the SAME use cases.
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

  if (m === 'POST' && path === '/orders') {
    const body = await readBody(req);
    const r = await uc.placeOrder(tenant, body);
    return r.ok ? { ok: true, status: 201, value: r.value } : r;
  }
  if (m === 'GET' && path === '/orders') {
    return await uc.listOrders(tenant);
  }
  let mt;
  if (m === 'GET' && (mt = path.match(/^\/orders\/([^/]+)$/))) {
    return await uc.getOrder(tenant, mt[1]);
  }
  if (m === 'POST' && path === '/sessions') {
    return { ...(await uc.openSession(tenant, await readBody(req))), status: 201 };
  }
  if (m === 'POST' && (mt = path.match(/^\/sessions\/([^/]+)\/items$/))) {
    return await uc.addSharedItem(tenant, mt[1], await readBody(req));
  }
  if (m === 'GET' && (mt = path.match(/^\/sessions\/([^/]+)\/split$/))) {
    return await uc.getSplit(tenant, mt[1], url.searchParams.get('mode') ?? 'by_item');
  }

  send(res, 404, { code: 'NOT_FOUND', message: `No route for ${m} ${path}` });
  return undefined;
}
