// Unified API — ONE process exposing every surface's endpoints over a SINGLE
// shared store + event bus. This is what makes the order flow real: a customer
// order, a kitchen bump, a waiter ack and a bill all read/write the same data,
// and the order-flow saga relays events between them. Contains NO business rules:
// it resolves the tenant, parses input, calls the composed use cases, maps
// AppError -> HTTP status, and relays the shared outbox to the bus (which fires
// the saga). Same request/JSON/tenant/outbox patterns as the per-surface BFFs.
import http from 'node:http';
import { AppError, UnauthorizedError } from '#core';
import { withTenant, resolveTenantFromHeaders } from '#tenancy';
import { openTableBill } from '../../../services/orchestration/src/tableBill.js';

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
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
      if (req.method === 'GET' && (path === '/healthz' || path === '/')) {
        return send(res, 200, { status: 'ok', service: 'restorna-api' });
      }

      const tenant = resolveTenantFromHeaders(req.headers);
      if (!tenant) throw new UnauthorizedError('Missing x-tenant-id header');

      await withTenant(tenant, async () => {
        const result = await route(req, res, path, url, tenant, useCases);
        if (result === undefined) return; // already handled (404)
        if (!result.ok) throw result.error;
        // Relay the outbox so the order-flow saga fires (OrderPlaced -> kitchen/floor,
        // TicketReady -> floor/billing). Loop until drained, since saga handlers
        // themselves stage follow-on events into the same outbox.
        let total = 0, n;
        do { n = await outbox.relayTo(bus); total += n; } while (n > 0);
        if (total && logger) logger.info('events.published', { count: total });
        send(res, result.status ?? 200, result.value);
      });
    } catch (e) {
      const status = e instanceof AppError ? e.status : 500;
      send(res, status, e instanceof AppError ? e.toJSON() : { code: 'INTERNAL', message: 'Internal error' });
    }
  });
}

// Deterministic 0..1 pseudo-metric for the owner Menu-IQ grid (stable per name).
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }
const r2 = (n) => Math.round(n * 100) / 100;

async function route(req, res, path, url, tenant, uc) {
  const m = req.method;
  let mt;

  /* ───────────────────────── Customer ───────────────────────── */
  if (m === 'GET' && path === '/menu') {
    const prefsRaw = url.searchParams.get('prefs');
    const prefs = prefsRaw ? prefsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    if (prefs.length === 0) return await uc.catalog.getMenu(tenant);
    const r = await uc.catalog.evaluateMenu(tenant, { prefs });
    if (!r.ok) return r;
    return { ok: true, value: r.value.map(({ item, ok, reasons }) => ({ item, suitable: ok, reasons })) };
  }
  if (m === 'POST' && path === '/orders') {
    const r = await uc.ordering.placeOrder(tenant, await readBody(req));
    return r.ok ? { ok: true, status: 201, value: r.value } : r;
  }
  if (m === 'GET' && (mt = path.match(/^\/orders\/([^/]+)$/))) {
    return await uc.ordering.getOrder(tenant, mt[1]);
  }
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
  if (m === 'POST' && path === '/checkout/quote') {
    const body = (await readBody(req)) ?? {};
    const r = await uc.promotions.evaluate(tenant, {
      subtotalMinor: body.subtotalMinor, couponCode: body.couponCode ?? null, category: body.category ?? null,
    });
    if (!r.ok) return r;
    return { ok: true, value: {
      subtotalMinor: body.subtotalMinor, discountMinor: r.value.discountMinor,
      applied: r.value.applied, totalMinor: body.subtotalMinor - r.value.discountMinor,
    } };
  }
  if (m === 'POST' && path === '/service-requests') {
    const body = (await readBody(req)) ?? {};
    return await uc.serviceRequests.raise(tenant, {
      type: body.type, table: body.table, assignedTo: body.assignedTo ?? null, now: Date.now(),
    });
  }

  /* ───────────────────────── Waiter ───────────────────────── */
  if (m === 'GET' && path === '/floor') return await uc.floor.getFloor(tenant);
  if (m === 'POST' && path === '/tables/assign') {
    const body = (await readBody(req)) ?? {};
    return await uc.floor.assignWaiter(tenant, { n: body.n, waiterId: body.waiterId });
  }
  if (m === 'POST' && path === '/tables/move') {
    const body = (await readBody(req)) ?? {};
    return await uc.floor.moveTable(tenant, { srcN: body.srcN, dstN: body.dstN });
  }
  // Waiter serves a ready table: food delivered, table goes back to dining
  // ('seated') so the serve prompt clears server-side and doesn't reappear.
  if (m === 'POST' && path === '/tables/serve') {
    const body = (await readBody(req)) ?? {};
    return await uc.floor.setTableStatus(tenant, { n: body.n, status: 'seated' });
  }
  if (m === 'GET' && path === '/requests') return await uc.serviceRequests.listOpen(tenant);
  if (m === 'POST' && path === '/requests/escalate') {
    const body = (await readBody(req)) ?? {};
    return await uc.serviceRequests.escalateDue(tenant, { now: body.now ?? Date.now() });
  }
  if (m === 'POST' && (mt = path.match(/^\/requests\/([^/]+)\/ack$/))) {
    const body = (await readBody(req)) ?? {};
    return await uc.serviceRequests.acknowledge(tenant, { requestId: mt[1], now: body.now ?? Date.now() });
  }

  /* ───────────────────────── Kitchen ───────────────────────── */
  if (m === 'GET' && path === '/board') return await uc.kitchen.getBoard(tenant);
  if (m === 'GET' && path === '/all-day') {
    const r = await uc.kitchen.allDay(tenant);
    if (!r.ok) return r;
    return { ok: true, value: Object.fromEntries(r.value) };
  }
  if (m === 'POST' && path === '/tickets/receive') {
    const body = (await readBody(req)) ?? {};
    const r = await uc.kitchen.receiveTicket(tenant, { orderId: body.orderId, table: body.table, items: body.items });
    return r.ok ? { ok: true, status: 201, value: r.value } : r;
  }
  if (m === 'POST' && (mt = path.match(/^\/tickets\/([^/]+)\/advance$/))) {
    const body = (await readBody(req)) ?? {};
    return await uc.kitchen.advanceItem(tenant, { ticketId: mt[1], itemIndex: body.itemIndex });
  }
  if (m === 'POST' && (mt = path.match(/^\/tickets\/([^/]+)\/bump$/))) {
    return await uc.kitchen.markAllReady(tenant, { ticketId: mt[1] });
  }
  if (m === 'POST' && path === '/menu/86') {
    const body = (await readBody(req)) ?? {};
    return await uc.catalog.toggleAvailability(tenant, { itemId: body.itemId, available: body.available });
  }

  /* ───────────────────────── Billing ───────────────────────── */
  if (m === 'GET' && path === '/bills') return await uc.billing.listOpen(tenant);

  // Running (not-yet-billed) orders for a table — what the waiter/billing agent
  // previews before generating the final bill. ?table=T7
  if (m === 'GET' && path === '/tables/orders') {
    const table = url.searchParams.get('table');
    if (!table) return { ok: true, value: [] };
    return await uc.ordering.listForTable(tenant, table);
  }
  // Dine-in "ask for the bill": waiter/billing initiates ONE final bill that
  // aggregates every open order for the table. { table: "T7" }
  if (m === 'POST' && path === '/bills/open-for-table') {
    const body = (await readBody(req)) ?? {};
    const r = await openTableBill({ useCases: uc, tenant, table: body.table });
    return r.ok ? { ok: true, status: 201, value: r.value } : r;
  }
  if (m === 'POST' && path === '/bills') {
    const body = (await readBody(req)) ?? {};
    const r = await uc.billing.openBill(tenant, { orderId: body.orderId, table: body.table, lines: body.lines });
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
      method: body.method, amountMinor: body.amountMinor, tenderedMinor: body.tenderedMinor,
    });
    return r.ok ? { ok: true, status: 201, value: r.value } : r;
  }
  if (m === 'POST' && path === '/quote') {
    const body = (await readBody(req)) ?? {};
    const r = await uc.promotions.evaluate(tenant, {
      subtotalMinor: body.subtotalMinor, couponCode: body.couponCode ?? null, category: body.category ?? null,
    });
    if (!r.ok) return r;
    return { ok: true, value: { discountMinor: r.value.discountMinor, applied: r.value.applied } };
  }

  /* ───────────────────────── Owner ───────────────────────── */
  if (m === 'GET' && path === '/owner/menu-engineering') {
    const r = await uc.catalog.getMenu(tenant);
    const items = r && r.ok ? r.value : [];
    const dishes = items.map((it) => {
      const h = hash(it.name || it.id);
      const priceMinor = it.price?.minor ?? it.priceMinor ?? 0;
      return {
        id: it.id, name: it.name,
        profit: r2(Math.min(0.95, 0.28 + priceMinor / 60000 + ((h >> 4) % 18) / 100)),
        popularity: r2(0.18 + (h % 80) / 100),
      };
    });
    return { ok: true, value: { dishes } };
  }
  if (m === 'GET' && path === '/owner/dashboard') {
    return { ok: true, value: OWNER_DASHBOARD };
  }

  send(res, 404, { code: 'NOT_FOUND', message: `No route for ${m} ${path}` });
  return undefined;
}

// Illustrative ops metrics until the Analytics read-model service ships.
const OWNER_DASHBOARD = {
  covers: { value: 184, target: 200 },
  revenue: { minor: 21450000, targetMinor: 25000000 },
  avgTurnMinutes: 62,
  liveTables: { occupied: 17, total: 24 },
  sales: [120000, 90000, 210000, 480000, 1120000, 1680000, 1240000, 760000, 540000, 980000, 1820000, 2140000, 1560000, 880000, 420000],
  stations: [
    { id: 'grill', name: 'Grill', load: 0.82, status: 'green' },
    { id: 'tandoor', name: 'Tandoor', load: 0.94, status: 'amber' },
    { id: 'cold', name: 'Cold', load: 0.41, status: 'green' },
    { id: 'bar', name: 'Bar', load: 0.68, status: 'blue' },
  ],
  promotions: [
    { id: 'happy', name: 'Happy hour', detail: '6–8pm · 20% off bar', live: true, upliftPct: 14 },
    { id: 'coup-welcome', name: 'WELCOME20 coupon', detail: '20% off above ₹300', live: false, redemptions: 38, revenueMinor: 9120000 },
  ],
  attention: [
    'Tandoor running hot — 94% load, 3 tickets aged over 12 min',
    'Covers tracking 16 below target for this hour',
    '2 tables seated 90+ min with no closing bill',
  ],
};
