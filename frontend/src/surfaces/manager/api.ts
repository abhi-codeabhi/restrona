import { createClient, BASES } from '../../lib/api';

/* Manager console talks to the unified API via BASES.owner (VITE_OWNER_API or the
   single VITE_API_URL). It drives the day-to-day floor levers an owner delegates:
   team roster + table assignment, table QR codes, menu 86-ing, and the nudge
   cadence config. */
const c = createClient(BASES.owner);

// ── Types ─────────────────────────────────────────────────────────────────────
export type Staff = { id: string; name: string; role: string; disabled: boolean };
export type MenuItem = { id: string; name: string; category: string; available: boolean; priceMinor: number };
export type FloorTable = { n: number; status: string; waiterId: string | null };
export type NudgeConfig = {
  greet: { enabled: boolean; delaySecs: number };
  checkin: { enabled: boolean; afterServeSecs: number };
  anythingElse: { enabled: boolean; afterCheckinSecs: number };
};

// ── Helpers ───────────────────────────────────────────────────────────────────
// API responses may be a raw array or wrapped as { value: [...] }; handle both.
function listOf(r: any): any[] {
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r.value)) return r.value;
  return [];
}
// Money arrives as { minor } (or a bare number); map to minor units defensively.
function minorOf(m: any): number {
  if (m == null) return 0;
  if (typeof m === 'number') return m;
  return m.minor ?? 0;
}

// ── Normalizers ───────────────────────────────────────────────────────────────
export function normalizeStaff(r: any): Staff[] {
  return listOf(r).map((s: any) => ({
    id: String(s.id ?? s.staffId ?? s.waiterId ?? ''),
    name: String(s.name ?? 'Unnamed'),
    role: String(s.role ?? 'waiter'),
    disabled: Boolean(s.disabled ?? s.inactive ?? false),
  }));
}

export function normalizeMenu(r: any): MenuItem[] {
  return listOf(r).map((m: any) => ({
    id: String(m.id ?? m.itemId ?? ''),
    name: String(m.name ?? 'Item'),
    category: String(m.category ?? 'Other'),
    available: m.available !== false,
    priceMinor: minorOf(m.price ?? m.priceMinor),
  }));
}

// GET /floor returns a floor DOC { tables:[...] } (may be wrapped as { value:{tables} }),
// but be forgiving if a raw array or { value:[...] } shows up instead.
export function normalizeFloor(r: any): FloorTable[] {
  const doc = r && r.value && !Array.isArray(r.value) ? r.value : r;
  const src = Array.isArray(doc) || (doc && Array.isArray(doc.value)) ? listOf(doc) : listOf(doc?.tables);
  return src
    .map((t: any) => ({
      n: Number(t.n ?? t.table ?? t.number ?? 0),
      status: String(t.status ?? 'free'),
      waiterId: t.waiterId != null ? String(t.waiterId) : null,
    }))
    .sort((a, b) => a.n - b.n);
}

export function normalizeNudgeConfig(r: any): NudgeConfig {
  const cfg = (r && r.config) || r || {};
  const greet = cfg.greet || {};
  const checkin = cfg.checkin || {};
  const anythingElse = cfg.anythingElse || {};
  return {
    greet: { enabled: greet.enabled !== false, delaySecs: Number(greet.delaySecs ?? 0) },
    checkin: { enabled: checkin.enabled !== false, afterServeSecs: Number(checkin.afterServeSecs ?? 0) },
    anythingElse: { enabled: anythingElse.enabled !== false, afterCheckinSecs: Number(anythingElse.afterCheckinSecs ?? 0) },
  };
}

// ── API ───────────────────────────────────────────────────────────────────────
export const managerApi = {
  getStaff: () => c.get('/admin/staff'),
  addStaff: (name: string, role: string) => c.post('/admin/staff', { name, role }),
  disableStaff: (id: string) => c.post('/admin/staff/' + encodeURIComponent(id) + '/disable'),
  getFloor: () => c.get('/floor'),
  // Assign MANY tables to one waiter at once; reassigning just moves a table.
  assignTables: (ns: number[], waiterId: string) => c.post('/admin/tables/assign', { ns, waiterId }),
  getAllMenu: () => c.get('/menu/all'),
  toggleItem: (itemId: string, available: boolean) => c.post('/menu/86', { itemId, available }),
  getNudgeConfig: () => c.get('/admin/nudge-config'),
  saveNudgeConfig: (config: NudgeConfig) => c.post('/admin/nudge-config', { config }),
};
