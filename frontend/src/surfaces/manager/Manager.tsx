import React, { useEffect, useMemo, useState } from 'react';
// @ts-ignore — qrcode ships its own runtime; esbuild doesn't need the types.
import QRCode from 'qrcode';
import {
  managerApi, normalizeStaff, normalizeMenu, normalizeFloor, normalizeNudgeConfig,
  type Staff, type MenuItem, type FloorTable, type NudgeConfig,
} from './api';
import { money } from '../../lib/format';

/* Manager console — the floor levers an owner delegates. Psychology baked in:
   - chunked into four tabs (Miller/Hick) so each view holds one job in mind;
   - exactly one brass primary action per view (Von Restorff) — the rest stays calm;
   - every change is immediate, reversible, and confirmed by a toast (Doherty);
   - copy is positive and plain — no alarms, no dark patterns, nothing hidden. */

const ROLES = ['waiter', 'kitchen', 'cashier', 'manager'];
const ROLE_COLOR: Record<string, string> = {
  waiter: 'var(--g)', kitchen: 'var(--amber)', cashier: 'var(--blue)', manager: 'var(--plum)',
};

export default function Manager() {
  const [tab, setTab] = useState<'team' | 'tables' | 'menu' | 'nudges'>('team');
  const [toast, setToast] = useState('');
  function flash(m: string) { setToast(m); window.setTimeout(() => setToast(''), 2400); }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 16px 60px' }}>
      <div style={{ padding: '18px 0 12px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="kicker">Manager</div>
          <div style={{ fontSize: 21, fontWeight: 600 }}>Console</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Tab on={tab === 'team'} onClick={() => setTab('team')}>Team</Tab>
          <Tab on={tab === 'tables'} onClick={() => setTab('tables')}>Tables (QR)</Tab>
          <Tab on={tab === 'menu'} onClick={() => setTab('menu')}>Menu</Tab>
          <Tab on={tab === 'nudges'} onClick={() => setTab('nudges')}>Nudges</Tab>
        </div>
      </div>

      {tab === 'team' && <TeamTab flash={flash} />}
      {tab === 'tables' && <TablesTab flash={flash} />}
      {tab === 'menu' && <MenuTab flash={flash} />}
      {tab === 'nudges' && <NudgesTab flash={flash} />}

      <div className={'rz-toast' + (toast ? ' show' : '')}>{toast}</div>
    </div>
  );
}

function Tab({ on, onClick, children }: any) {
  return (
    <button onClick={onClick} style={{
      border: `0.5px solid ${on ? 'var(--g)' : 'var(--border2)'}`,
      background: on ? 'var(--gs)' : 'var(--surface)',
      color: on ? 'var(--gtx)' : 'var(--muted)',
      fontWeight: on ? 600 : 400, fontSize: 13, padding: '8px 16px', borderRadius: 20, cursor: 'pointer',
    }}>{children}</button>
  );
}

const INPUT: React.CSSProperties = { height: 38, border: '0.5px solid var(--border)', borderRadius: 10, padding: '0 12px', background: 'var(--surface)', color: 'var(--ink)', fontSize: 14 };

function Loading({ what }: { what: string }) { return <div className="rz-empty">Loading {what}…</div>; }
function ErrorBox({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="rz-empty" style={{ color: 'var(--red)' }}>{msg}<br />
      <button className="rz-ghost" style={{ marginTop: 12, width: 'auto', padding: '0 16px' }} onClick={onRetry}>Retry</button>
    </div>
  );
}

// ── Team tab ────────────────────────────────────────────────────────────────
function TeamTab({ flash }: any) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [floor, setFloor] = useState<FloorTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // add-member form
  const [name, setName] = useState('');
  const [role, setRole] = useState('waiter');

  // assignment workspace
  const [waiterId, setWaiterId] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());

  async function load() {
    setLoading(true); setError(null);
    try {
      const [s, f] = await Promise.all([managerApi.getStaff(), managerApi.getFloor()]);
      setStaff(normalizeStaff(s)); setFloor(normalizeFloor(f));
    } catch (e: any) { setError(e?.message || 'Could not load the team'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const activeStaff = useMemo(() => staff.filter((s) => !s.disabled), [staff]);
  const waiters = useMemo(() => staff.filter((s) => !s.disabled && s.role === 'waiter'), [staff]);
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name || 'that waiter';

  // group table numbers by their owning waiter, plus an unassigned bucket.
  const grouped = useMemo(() => {
    const m = new Map<string, number[]>();
    const unassigned: number[] = [];
    for (const t of floor) {
      if (t.waiterId) { const cur = m.get(t.waiterId) || []; cur.push(t.n); m.set(t.waiterId, cur); }
      else unassigned.push(t.n);
    }
    return { m, unassigned };
  }, [floor]);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try { await managerApi.addStaff(name.trim(), role); flash(name.trim() + ' added to the team'); setName(''); setRole('waiter'); await load(); }
    catch (e: any) { flash(e?.message || 'Could not add member'); }
    finally { setBusy(false); }
  }

  async function disable(s: Staff) {
    setBusy(true);
    try { await managerApi.disableStaff(s.id); flash(s.name + ' set inactive'); await load(); }
    catch (e: any) { flash(e?.message || 'Could not update'); }
    finally { setBusy(false); }
  }

  function togglePick(n: number) {
    setPicked((prev) => { const next = new Set(prev); next.has(n) ? next.delete(n) : next.add(n); return next; });
  }

  async function assign() {
    if (!waiterId || picked.size === 0) return;
    setBusy(true);
    const ns = [...picked].sort((a, b) => a - b);
    try {
      await managerApi.assignTables(ns, waiterId);
      flash(ns.length + ' table' + (ns.length === 1 ? '' : 's') + ' → ' + nameOf(waiterId));
      setPicked(new Set());
      await load();
    } catch (e: any) { flash(e?.message || 'Could not assign tables'); }
    finally { setBusy(false); }
  }

  if (loading) return <Loading what="the team" />;
  if (error) return <ErrorBox msg={error} onRetry={load} />;

  return (
    <div>
      {/* Roster + add member */}
      <div className="rz-card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="kicker" style={{ marginBottom: 10 }}>Team</div>
        {staff.length === 0 && <div className="xs muted">No team members yet — add the first below.</div>}
        {staff.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '0.5px solid var(--border)', opacity: s.disabled ? 0.5 : 1 }}>
            <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{s.name}</span>
            <span className="rz-pill" style={{ background: s.disabled ? undefined : 'var(--gs)', color: s.disabled ? 'var(--muted)' : (ROLE_COLOR[s.role] || 'var(--gtx)'), textTransform: 'capitalize' }}>{s.role}</span>
            {s.disabled
              ? <span className="xs muted" style={{ width: 96, textAlign: 'right' }}>Inactive</span>
              : <button className="rz-ghost" style={{ width: 'auto', padding: '0 14px', height: 32 }} disabled={busy} onClick={() => disable(s)}>Disable</button>}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()} style={{ ...INPUT, flex: '2 1 150px' }} />
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...INPUT, flex: '1 1 110px', textTransform: 'capitalize' }}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button className="rz-cta" style={{ width: 'auto', flex: '0 0 auto', padding: '0 18px' }} disabled={busy || !name.trim()} onClick={add}>
            {busy ? 'Adding…' : 'Add member'}
          </button>
        </div>
      </div>

      {/* Table assignments */}
      <div className="rz-card" style={{ padding: 16 }}>
        <div className="kicker" style={{ marginBottom: 4 }}>Table assignments</div>
        <div className="xs muted" style={{ marginBottom: 12 }}>Who covers what right now. Reassigning a table simply moves it — nothing is lost.</div>

        {waiters.map((w) => {
          const tables = (grouped.m.get(w.id) || []).sort((a, b) => a - b);
          return (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '0.5px solid var(--border)', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: 13.5, width: 110, flex: '0 0 auto' }}>{w.name}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                {tables.length === 0 && <span className="xs muted">No tables</span>}
                {tables.map((n) => <span key={n} className="rz-pill" style={{ background: 'var(--gs)', color: 'var(--gtx)' }}>T{n}</span>)}
              </div>
            </div>
          );
        })}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontWeight: 600, fontSize: 13.5, width: 110, flex: '0 0 auto' }}>Unassigned</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            {grouped.unassigned.length === 0 && <span className="xs muted">None — every table is covered</span>}
            {grouped.unassigned.sort((a, b) => a - b).map((n) => <span key={n} className="rz-pill">T{n}</span>)}
          </div>
        </div>

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '0.5px solid var(--border)' }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Assign tables</div>
          {waiters.length === 0 && <div className="xs muted">Add an active waiter above to assign tables.</div>}
          {waiters.length > 0 && (
            <>
              <select value={waiterId} onChange={(e) => setWaiterId(e.target.value)} style={{ ...INPUT, width: '100%', marginBottom: 10 }}>
                <option value="">Choose a waiter…</option>
                {waiters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <div className="xs muted" style={{ marginBottom: 8 }}>Tap the tables to assign — tap again to deselect.</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                {floor.map((t) => {
                  const on = picked.has(t.n);
                  return (
                    <button key={t.n} onClick={() => togglePick(t.n)} style={{
                      fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 12, cursor: 'pointer',
                      border: `1px solid ${on ? 'var(--g)' : 'var(--border)'}`,
                      background: on ? 'var(--g)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)',
                    }}>T{t.n}</button>
                  );
                })}
              </div>
              <button className="rz-cta" disabled={busy || !waiterId || picked.size === 0} onClick={assign}>
                {!waiterId || picked.size === 0
                  ? 'Pick a waiter and tables'
                  : `Assign ${picked.size} table${picked.size === 1 ? '' : 's'} to ${nameOf(waiterId)}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tables (QR) tab ───────────────────────────────────────────────────────────
function TablesTab({ flash }: any) {
  const [floor, setFloor] = useState<FloorTable[]>([]);
  const [qr, setQr] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const urlFor = (n: number) => `${window.location.origin}/customer?table=${n}`;

  async function load() {
    setLoading(true); setError(null);
    try { setFloor(normalizeFloor(await managerApi.getFloor())); }
    catch (e: any) { setError(e?.message || 'Could not load the floor'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Generate one QR data URL per table, keyed by table number.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<number, string> = {};
      for (const t of floor) {
        try { out[t.n] = await QRCode.toDataURL(urlFor(t.n), { margin: 1, width: 220 }); } catch { /* skip */ }
      }
      if (!cancelled) setQr(out);
    })();
    return () => { cancelled = true; };
  }, [floor]);

  function printTables(tables: FloorTable[]) {
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) { flash('Allow pop-ups to print QR codes'); return; }
    const cards = tables.map((t) => `
      <div class="card">
        <div class="num">Table ${t.n}</div>
        ${qr[t.n] ? `<img src="${qr[t.n]}" width="220" height="220" />` : ''}
        <div class="cap">Table ${t.n} · scan to view the menu &amp; order</div>
      </div>`).join('');
    w.document.write(`<!doctype html><html><head><title>Restorna · Table QR</title>
      <style>
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:24px;color:#1a1a1a;}
        .card{page-break-inside:avoid;text-align:center;padding:34px 0;border-bottom:1px dashed #ccc;}
        .num{font-size:34px;font-weight:700;margin-bottom:14px;}
        .cap{margin-top:14px;font-size:14px;color:#555;}
        @media print{.card{border-bottom:none;}}
      </style></head><body>${cards}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  if (loading) return <Loading what="the floor" />;
  if (error) return <ErrorBox msg={error} onRetry={load} />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div className="sm muted" style={{ flex: '1 1 220px' }}>Each table gets its own QR. Guests scan it to open the table-scoped menu — no login, no app.</div>
        <button className="rz-cta" style={{ width: 'auto', padding: '0 18px', flex: '0 0 auto' }} disabled={floor.length === 0} onClick={() => printTables(floor)}>Print all</button>
      </div>

      {floor.length === 0 && <div className="rz-empty">No tables on the floor yet.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
        {floor.map((t) => (
          <div key={t.n} className="rz-card" style={{ padding: 18, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 30, fontWeight: 700 }}>Table {t.n}</div>
            <div style={{ width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {qr[t.n]
                ? <img src={qr[t.n]} alt={`QR for table ${t.n}`} width={160} height={160} style={{ borderRadius: 8 }} />
                : <span className="xs muted">Generating…</span>}
            </div>
            <div className="xs muted">Scan to view the menu &amp; order</div>
            <button className="rz-ghost" style={{ width: 'auto', padding: '0 18px' }} onClick={() => printTables([t])}>Print</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Menu tab ──────────────────────────────────────────────────────────────────
function MenuTab({ flash }: any) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setItems(normalizeMenu(await managerApi.getAllMenu())); }
    catch (e: any) { setError(e?.message || 'Could not load the menu'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const groups = useMemo(() => {
    const out: Record<string, MenuItem[]> = {};
    for (const it of items) (out[it.category] ||= []).push(it);
    return Object.entries(out).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  async function toggle(it: MenuItem) {
    setBusy(it.id);
    try {
      await managerApi.toggleItem(it.id, !it.available);
      flash(it.available ? it.name + ' taken off menu' : it.name + ' back on menu');
      await load();
    } catch (e: any) { flash(e?.message || 'Could not update item'); }
    finally { setBusy(null); }
  }

  if (loading) return <Loading what="the menu" />;
  if (error) return <ErrorBox msg={error} onRetry={load} />;
  if (items.length === 0) return <div className="rz-empty">No menu items found.</div>;

  return (
    <div>
      <div className="sm muted" style={{ marginBottom: 14 }}>Toggling an item updates the live customer menu instantly — and you can flip it back any time.</div>
      {groups.map(([cat, list]) => (
        <div key={cat} className="rz-card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>{cat}</div>
          {list.map((it) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '0.5px solid var(--border)', opacity: it.available ? 1 : 0.55 }}>
              <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{it.name}</span>
              {!it.available && <span className="rz-pill">Off menu</span>}
              <span className="sm" style={{ width: 78, textAlign: 'right' }}>{money(it.priceMinor)}</span>
              <button onClick={() => toggle(it)} disabled={busy === it.id} style={{
                width: 'auto', minWidth: 108, padding: '0 14px', height: 32, borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                border: `1px solid ${it.available ? 'var(--g)' : 'var(--border2)'}`,
                background: it.available ? 'var(--gs)' : 'var(--surface)',
                color: it.available ? 'var(--gtx)' : 'var(--muted)',
              }}>{busy === it.id ? '…' : it.available ? 'Available' : 'Unavailable'}</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Nudges tab ──────────────────────────────────────────────────────────────
type NudgeKey = 'greet' | 'checkin' | 'anythingElse';
const NUDGE_META: { key: NudgeKey; secsField: string; label: string; blurb: string }[] = [
  { key: 'greet', secsField: 'delaySecs', label: 'Greet', blurb: 'A friendly greeting fires this many minutes after a table is seated.' },
  { key: 'checkin', secsField: 'afterServeSecs', label: 'How was the food', blurb: 'A check-in fires this many minutes after the food is served.' },
  { key: 'anythingElse', secsField: 'afterCheckinSecs', label: 'Anything else', blurb: 'An “anything else?” prompt fires this many minutes after the check-in.' },
];

function NudgesTab({ flash }: any) {
  const [cfg, setCfg] = useState<NudgeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setCfg(normalizeNudgeConfig(await managerApi.getNudgeConfig())); }
    catch (e: any) { setError(e?.message || 'Could not load nudge settings'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function setEnabled(key: NudgeKey, enabled: boolean) {
    setCfg((c) => c && ({ ...c, [key]: { ...(c[key] as any), enabled } }));
  }
  function setMinutes(key: NudgeKey, field: string, minutes: number) {
    const secs = Math.max(0, Math.round(minutes * 60));
    setCfg((c) => c && ({ ...c, [key]: { ...(c[key] as any), [field]: secs } }));
  }

  async function save() {
    if (!cfg) return;
    setBusy(true);
    try { await managerApi.saveNudgeConfig(cfg); flash('Nudge settings saved'); }
    catch (e: any) { flash(e?.message || 'Could not save settings'); }
    finally { setBusy(false); }
  }

  if (loading) return <Loading what="nudge settings" />;
  if (error || !cfg) return <ErrorBox msg={error || 'No settings'} onRetry={load} />;

  return (
    <div>
      <div className="sm muted" style={{ marginBottom: 14 }}>Automatic prompts that gently pace each table’s service. Turn any off, or tune how soon it fires.</div>
      <div className="rz-card" style={{ padding: 16 }}>
        {NUDGE_META.map((m, i) => {
          const node: any = (cfg as any)[m.key];
          const minutes = Math.round(((node[m.secsField] as number) || 0) / 60);
          return (
            <div key={m.key} style={{ padding: '12px 0', borderBottom: i < NUDGE_META.length - 1 ? '0.5px solid var(--border)' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{m.label}</span>
                <button onClick={() => setEnabled(m.key, !node.enabled)} style={{
                  width: 'auto', padding: '0 14px', height: 32, borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  border: `1px solid ${node.enabled ? 'var(--g)' : 'var(--border2)'}`,
                  background: node.enabled ? 'var(--gs)' : 'var(--surface)',
                  color: node.enabled ? 'var(--gtx)' : 'var(--muted)',
                }}>{node.enabled ? 'On' : 'Off'}</button>
              </div>
              <div className="xs muted" style={{ margin: '6px 0 8px' }}>{m.blurb}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: node.enabled ? 1 : 0.5 }}>
                <input type="number" min={0} value={minutes} disabled={!node.enabled}
                  onChange={(e) => setMinutes(m.key, m.secsField, Number(e.target.value))}
                  style={{ ...INPUT, width: 84 }} />
                <span className="xs muted">minutes</span>
              </div>
            </div>
          );
        })}
        <button className="rz-cta" style={{ marginTop: 16 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
