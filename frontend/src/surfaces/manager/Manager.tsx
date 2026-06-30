import React, { useEffect, useMemo, useState } from 'react';
import {
  managerApi, normalizeStaff, normalizeMenu, normalizeFloor, normalizeNudgeConfig,
  type Staff, type MenuItem, type FloorTable, type NudgeConfig,
} from './api';
import { money } from '../../lib/format';

/* Manager console — the floor-runner surface an owner delegates to. Three calm
   tabs, one brass primary action each, status-tinted where it helps:
   - Team: roster at a glance, add a waiter inline, assign a table to a server.
   - Menu: every item grouped by course with a one-tap 86 toggle; muted when off.
   - Nudges: the service-cadence config, shown in plain minutes, saved in seconds. */

const ROLES = ['waiter', 'kitchen', 'cashier', 'manager'];

export default function Manager() {
  const [tab, setTab] = useState<'team' | 'menu' | 'nudges'>('team');
  const [toast, setToast] = useState('');
  function flash(m: string) { setToast(m); window.setTimeout(() => setToast(''), 2400); }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 16px 60px' }}>
      <div style={{ padding: '18px 0 12px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="kicker">Manager</div>
          <div style={{ fontSize: 21, fontWeight: 600 }}>Console</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Tab on={tab === 'team'} onClick={() => setTab('team')}>Team</Tab>
          <Tab on={tab === 'menu'} onClick={() => setTab('menu')}>Menu</Tab>
          <Tab on={tab === 'nudges'} onClick={() => setTab('nudges')}>Nudges</Tab>
        </div>
      </div>

      {tab === 'team' && <TeamTab flash={flash} />}
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

const INPUT: React.CSSProperties = { height: 38, border: '0.5px solid var(--border)', borderRadius: 10, padding: '0 12px', background: 'var(--surface)' };

// ── Team tab ────────────────────────────────────────────────────────────────
function TeamTab({ flash }: any) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [floor, setFloor] = useState<FloorTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [role, setRole] = useState('waiter');
  const [assignN, setAssignN] = useState('');
  const [assignStaff, setAssignStaff] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [s, f] = await Promise.all([managerApi.getStaff(), managerApi.getFloor()]);
      setStaff(normalizeStaff(s)); setFloor(normalizeFloor(f));
    } catch (e: any) { setError(e?.message || 'Could not load the team'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const waiters = useMemo(() => staff.filter((s) => !s.disabled && s.role === 'waiter'), [staff]);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try { await managerApi.addStaff(name.trim(), role); setName(''); flash('Added ' + name.trim()); await load(); }
    catch (e: any) { flash(e?.message || 'Could not add staff'); }
    finally { setBusy(false); }
  }

  async function disable(s: Staff) {
    setBusy(true);
    try { await managerApi.disableStaff(s.id); flash(s.name + ' disabled'); await load(); }
    catch (e: any) { flash(e?.message || 'Could not disable'); }
    finally { setBusy(false); }
  }

  async function assign() {
    if (!assignN || !assignStaff) return;
    setBusy(true);
    try { await managerApi.assignTable(Number(assignN), assignStaff); flash('Table ' + assignN + ' assigned'); await load(); }
    catch (e: any) { flash(e?.message || 'Could not assign'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="rz-empty">Loading the team…</div>;
  if (error) return (
    <div className="rz-empty" style={{ color: 'var(--red)' }}>{error}<br />
      <button className="rz-ghost" style={{ marginTop: 12, width: 'auto', padding: '0 16px' }} onClick={load}>Retry</button></div>
  );

  return (
    <div>
      <div className="rz-card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="kicker" style={{ marginBottom: 10 }}>Roster</div>
        {staff.length === 0 && <div className="xs muted">No staff yet.</div>}
        {staff.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '0.5px solid var(--border)', opacity: s.disabled ? 0.5 : 1 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
              <div className="xs muted" style={{ textTransform: 'capitalize' }}>{s.role}</div>
            </div>
            {s.disabled
              ? <span className="rz-pill" style={{ color: 'var(--muted)' }}>Disabled</span>
              : <button className="rz-ghost" style={{ width: 'auto', padding: '0 14px', height: 32 }} disabled={busy} onClick={() => disable(s)}>Disable</button>}
          </div>
        ))}
      </div>

      <div className="rz-card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="kicker" style={{ marginBottom: 10 }}>Add waiter</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...INPUT, flex: '1 1 160px' }} />
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...INPUT, flex: '0 0 auto', textTransform: 'capitalize' }}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button className="rz-cta" style={{ width: 'auto', padding: '0 20px' }} disabled={busy || !name.trim()} onClick={add}>Add</button>
        </div>
      </div>

      <div className="rz-card" style={{ padding: 16 }}>
        <div className="kicker" style={{ marginBottom: 10 }}>Assign table</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={assignN} onChange={(e) => setAssignN(e.target.value)} style={{ ...INPUT, flex: '1 1 120px' }}>
            <option value="">Table…</option>
            {floor.map((t) => <option key={t.n} value={t.n}>Table {t.n}</option>)}
          </select>
          <select value={assignStaff} onChange={(e) => setAssignStaff(e.target.value)} style={{ ...INPUT, flex: '1 1 160px' }}>
            <option value="">Waiter…</option>
            {waiters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="rz-cta" style={{ width: 'auto', padding: '0 20px' }} disabled={busy || !assignN || !assignStaff} onClick={assign}>Assign</button>
        </div>
        {waiters.length === 0 && <div className="xs muted" style={{ marginTop: 8 }}>Add an active waiter to assign tables.</div>}
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
    return Object.entries(out);
  }, [items]);

  async function toggle(it: MenuItem) {
    setBusy(it.id);
    try { await managerApi.toggleItem(it.id, !it.available); flash(it.name + (it.available ? ' marked unavailable' : ' available')); await load(); }
    catch (e: any) { flash(e?.message || 'Could not update'); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="rz-empty">Loading the menu…</div>;
  if (error) return (
    <div className="rz-empty" style={{ color: 'var(--red)' }}>{error}<br />
      <button className="rz-ghost" style={{ marginTop: 12, width: 'auto', padding: '0 16px' }} onClick={load}>Retry</button></div>
  );
  if (items.length === 0) return <div className="rz-empty">No menu items.</div>;

  return (
    <div>
      {groups.map(([cat, list]) => (
        <div key={cat} className="rz-card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="kicker" style={{ marginBottom: 10 }}>{cat}</div>
          {list.map((it) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '0.5px solid var(--border)', opacity: it.available ? 1 : 0.5 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{it.name}</div>
                <div className="xs muted">{money(it.priceMinor)}</div>
              </div>
              <button
                onClick={() => toggle(it)}
                disabled={busy === it.id}
                style={{
                  width: 'auto', padding: '0 14px', height: 32, borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  border: `0.5px solid ${it.available ? 'var(--g)' : 'var(--border2)'}`,
                  background: it.available ? 'var(--gs)' : 'var(--surface)',
                  color: it.available ? 'var(--gtx)' : 'var(--muted)',
                }}
              >{it.available ? 'Available' : 'Unavailable'}</button>
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
  { key: 'greet', secsField: 'delaySecs', label: 'Greet', blurb: 'Welcome a newly seated table after this long.' },
  { key: 'checkin', secsField: 'afterServeSecs', label: 'Check-in', blurb: 'Quietly check back once food has been served.' },
  { key: 'anythingElse', secsField: 'afterCheckinSecs', label: 'Anything else?', blurb: 'Offer more / the bill after the check-in.' },
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
    catch (e: any) { flash(e?.message || 'Could not save'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="rz-empty">Loading nudge settings…</div>;
  if (error || !cfg) return (
    <div className="rz-empty" style={{ color: 'var(--red)' }}>{error || 'No settings'}<br />
      <button className="rz-ghost" style={{ marginTop: 12, width: 'auto', padding: '0 16px' }} onClick={load}>Retry</button></div>
  );

  return (
    <div>
      <div className="sm muted" style={{ marginBottom: 14 }}>
        The gentle prompts your servers get during a table’s journey. Times are in minutes.
      </div>
      {NUDGE_META.map((m) => {
        const node: any = (cfg as any)[m.key];
        const minutes = Math.round(((node[m.secsField] as number) || 0) / 60);
        return (
          <div key={m.key} className="rz-card" style={{ padding: 16, marginBottom: 12, opacity: node.enabled ? 1 : 0.6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{m.label}</div>
                <div className="xs muted">{m.blurb}</div>
              </div>
              <button
                onClick={() => setEnabled(m.key, !node.enabled)}
                style={{
                  width: 'auto', padding: '0 14px', height: 32, borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  border: `0.5px solid ${node.enabled ? 'var(--g)' : 'var(--border2)'}`,
                  background: node.enabled ? 'var(--gs)' : 'var(--surface)',
                  color: node.enabled ? 'var(--gtx)' : 'var(--muted)',
                }}
              >{node.enabled ? 'On' : 'Off'}</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <input
                type="number" min={0} value={minutes}
                onChange={(e) => setMinutes(m.key, m.secsField, Number(e.target.value))}
                style={{ ...INPUT, width: 90 }}
              />
              <span className="sm muted">minutes</span>
            </div>
          </div>
        );
      })}
      <button className="rz-cta" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
}
