import { createClient, BASES } from '../../lib/api';

/* The unified API serves /owner/dashboard + /owner/menu-engineering; calls fall
   back to seeded demo data on any failure. BASES.owner resolves to VITE_OWNER_API
   or the single VITE_API_URL. */
const c = createClient(BASES.owner);

// ── Seeded demo data (used until the admin BFF is wired) ──────────────────────
const DEMO_DASHBOARD = {
  covers: { value: 184, target: 200 },
  revenue: { minor: 21450000, targetMinor: 25000000 },
  avgTurnMinutes: 62,
  liveTables: { occupied: 17, total: 24 },
  // hourly net sales (minor units) across the service day, for the sparkline
  sales: [
    120000, 90000, 210000, 480000, 1120000, 1680000, 1240000, 760000,
    540000, 980000, 1820000, 2140000, 1560000, 880000, 420000,
  ],
  stations: [
    { id: 'grill', name: 'Grill', load: 0.82, status: 'green' },
    { id: 'tandoor', name: 'Tandoor', load: 0.94, status: 'amber' },
    { id: 'cold', name: 'Cold', load: 0.41, status: 'green' },
    { id: 'bar', name: 'Bar', load: 0.68, status: 'blue' },
  ],
  promotions: [
    { id: 'happy', name: 'Happy hour', detail: '6–8pm · 20% off bar', live: true, upliftPct: 14 },
    { id: 'coup-fest', name: 'FEST25 coupon', detail: '₹250 off above ₹1,500', live: false, redemptions: 38, revenueMinor: 9120000 },
  ],
  attention: [
    'Tandoor running hot — 94% load, 3 tickets aged over 12 min',
    'Covers tracking 16 below target for this hour',
    '2 tables seated 90+ min with no closing bill',
  ],
};

const DEMO_MENU_IQ = {
  // profit (margin) × popularity (volume), each 0..1
  dishes: [
    { id: 'd1', name: 'Butter chicken', profit: 0.82, popularity: 0.91 },
    { id: 'd2', name: 'Garlic naan', profit: 0.74, popularity: 0.88 },
    { id: 'd3', name: 'Paneer tikka', profit: 0.41, popularity: 0.79 },
    { id: 'd4', name: 'Dal makhani', profit: 0.38, popularity: 0.83 },
    { id: 'd5', name: 'Lamb shank', profit: 0.86, popularity: 0.22 },
    { id: 'd6', name: 'Saffron kulfi', profit: 0.71, popularity: 0.18 },
    { id: 'd7', name: 'House salad', profit: 0.29, popularity: 0.24 },
    { id: 'd8', name: 'Mango lassi', profit: 0.33, popularity: 0.21 },
  ],
};

// Classify a dish into the profit×popularity quadrant + a recommended action.
export function classify(d: any): { quadrant: string; action: string } {
  const hiProfit = d.profit >= 0.5;
  const hiPop = d.popularity >= 0.5;
  if (hiProfit && hiPop) return { quadrant: 'stars', action: 'feature' };
  if (!hiProfit && hiPop) return { quadrant: 'plowhorses', action: 'reprice' };
  if (hiProfit && !hiPop) return { quadrant: 'puzzles', action: 'promote' };
  return { quadrant: 'dogs', action: 'cut' };
}

export const ownerApi = {
  async getDashboard() {
    try {
      const r = await c.get('/owner/dashboard');
      return { data: r, live: true };
    } catch {
      return { data: DEMO_DASHBOARD, live: false };
    }
  },
  async getMenuEngineering() {
    try {
      const r = await c.get('/owner/menu-engineering');
      return { data: r, live: true };
    } catch {
      return { data: DEMO_MENU_IQ, live: false };
    }
  },
};
