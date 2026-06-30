// Owner/admin BFF — read-only executive surface. Composes catalog (real menu →
// Menu-IQ) with illustrative ops metrics (covers/revenue/stations) that will be
// served by the Analytics service once it exists. No business rules here.
import http from 'node:http';
import { AppError, UnauthorizedError } from '#core';
import { withTenant, resolveTenantFromHeaders } from '#tenancy';

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

// Deterministic 0..1 pseudo-metric from a string (stable across calls).
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }
const r2 = (n) => Math.round(n * 100) / 100;

export function createServer({ useCases, logger }) {
  return http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    try {
      if (req.method === 'GET' && path === '/healthz') return send(res, 200, { status: 'ok' });

      const tenant = resolveTenantFromHeaders(req.headers);
      if (!tenant) throw new UnauthorizedError('Missing x-tenant-id header');

      await withTenant(tenant, async () => {
        if (req.method === 'GET' && path === '/owner/menu-engineering') {
          const r = await useCases.catalog.getMenu(tenant);
          const items = r && r.ok ? r.value : [];
          const dishes = items.map((it) => {
            const h = hash(it.name || it.id);
            const popularity = r2(0.18 + (h % 80) / 100);                         // 0.18..0.97
            const profit = r2(Math.min(0.95, 0.28 + (it.priceMinor || 0) / 60000 + ((h >> 4) % 18) / 100));
            return { id: it.id, name: it.name, profit, popularity };
          });
          return send(res, 200, { dishes });
        }

        if (req.method === 'GET' && path === '/owner/dashboard') {
          // Ops metrics are illustrative until the Analytics read-model service ships.
          return send(res, 200, {
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
          });
        }

        send(res, 404, { code: 'NOT_FOUND', message: `No route for ${req.method} ${path}` });
      });
    } catch (e) {
      const status = e instanceof AppError ? e.status : 500;
      send(res, status, e instanceof AppError ? e.toJSON() : { code: 'INTERNAL', message: 'Internal error' });
    }
  });
}
