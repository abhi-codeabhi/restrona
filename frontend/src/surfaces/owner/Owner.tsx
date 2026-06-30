import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ownerApi, classify } from './api';
import { money } from '../../lib/format';

/* Owner console — the executive surface. Psychology baked in:
   - signal over noise: a single amber "needs attention" banner surfaces the
     exceptions worth a glance; everything else is a calm, glanceable read.
   - one brass accent for the one primary affordance; status colours stay semantic.
   - positive/neutral framing — "on track" rather than alarmist red everywhere.
   - Menu IQ turns the BCG-style profit×popularity grid into four plain-English
     buckets, each with a recommended next move. */

const QUADRANTS: Record<string, { label: string; blurb: string; color: string }> = {
  stars: { label: 'Stars', blurb: 'High profit · high demand', color: 'var(--green)' },
  plowhorses: { label: 'Plowhorses', blurb: 'Popular · thin margin', color: 'var(--blue)' },
  puzzles: { label: 'Puzzles', blurb: 'High margin · low demand', color: 'var(--plum)' },
  dogs: { label: 'Dogs', blurb: 'Low margin · low demand', color: 'var(--muted)' },
};

const ACTION_COPY: Record<string, string> = {
  feature: 'Feature it — keep it prominent on the menu and train staff to recommend.',
  reprice: 'Reprice or re-cost — small bump or cheaper plating lifts a popular dish.',
  promote: 'Promote it — strong margin, just needs visibility (bundle or special).',
  cut: 'Consider cutting — frees menu space and prep load for better performers.',
};

const ALERTS = [
  'Table 7 requested the bill',
  'Tandoor ticket #2241 aged 13 min',
  'Bar covers up 9% vs last Tuesday',
  'Happy hour redemption — ₹640 check',
  'Kitchen marked Lamb shank low-stock',
  'Table 12 seated — party of 4',
  'FEST25 coupon redeemed (×2)',
  'Avg turn improved to 58 min',
];

export default function Owner() {
  const [tab, setTab] = useState<'insights' | 'menuiq'>('insights');
  const [dash, setDash] = useState<any>(null);
  const [menu, setMenu] = useState<any>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [d, m] = await Promise.all([ownerApi.getDashboard(), ownerApi.getMenuEngineering()]);
      setDash(d.data); setMenu(m.data);
      setLive(d.live && m.live);
    } catch (e: any) {
      setError(e?.message || 'Could not load the owner console');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 16px 60px' }}>
      <div style={{ padding: '18px 0 12px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="kicker">Owner console</div>
          <div style={{ fontSize: 21, fontWeight: 600 }}>Restorna · Today</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Tab on={tab === 'insights'} onClick={() => setTab('insights')}>Insights</Tab>
          <Tab on={tab === 'menuiq'} onClick={() => setTab('menuiq')}>Menu IQ</Tab>
        </div>
      </div>

      {live === false && (
        <div className="xs muted" style={{ margin: '0 0 14px' }}>
          Owner insights API (admin BFF) is the next backend piece — showing demo data until it’s wired.
        </div>
      )}

      {loading && <div className="rz-empty">Loading the owner console…</div>}
      {!loading && error && (
        <div className="rz-empty" style={{ color: 'var(--red)' }}>
          {error}<br />
          <button className="rz-ghost" style={{ marginTop: 12, width: 'auto', padding: '0 16px' }} onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && tab === 'insights' && dash && <Insights dash={dash} />}
      {!loading && !error && tab === 'menuiq' && menu && <MenuIQ menu={menu} />}
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

// ── Insights tab ──────────────────────────────────────────────────────────────
function Insights({ dash }: any) {
  const coverPct = Math.round((dash.covers.value / dash.covers.target) * 100);
  const revPct = Math.round((dash.revenue.minor / dash.revenue.targetMinor) * 100);

  return (
    <div>
      {dash.attention?.length > 0 && (
        <div className="rz-card" style={{ borderColor: 'var(--amber)', background: '#FBF4E6', padding: '14px 16px', marginBottom: 16 }}>
          <div className="kicker" style={{ color: 'var(--amber)' }}>Needs attention</div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            {dash.attention.map((a: string, i: number) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Metric label="Covers" value={String(dash.covers.value)} sub={`${coverPct}% of ${dash.covers.target} target`} tone={coverPct >= 90 ? 'green' : 'amber'} />
        <Metric label="Revenue vs target" value={money(dash.revenue.minor)} sub={`${revPct}% of ${money(dash.revenue.targetMinor)}`} tone={revPct >= 90 ? 'green' : 'amber'} />
        <Metric label="Avg table turn" value={`${dash.avgTurnMinutes} min`} sub="seat → settle" tone="blue" />
        <Metric label="Live tables" value={`${dash.liveTables.occupied}/${dash.liveTables.total}`} sub="occupied now" tone="plum" />
      </div>

      <div className="rz-card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="kicker">Sales today</div>
        <Sparkline data={dash.sales} />
        <div className="xs muted" style={{ marginTop: 4 }}>Net sales by hour · open to close</div>
      </div>

      <div className="rz-card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="kicker" style={{ marginBottom: 12 }}>Station load</div>
        {dash.stations.map((s: any) => <StationBar key={s.id} s={s} />)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div className="rz-card" style={{ padding: 16 }}>
          <div className="kicker" style={{ marginBottom: 10 }}>Promotion impact</div>
          {dash.promotions.map((p: any) => <PromoRow key={p.id} p={p} />)}
        </div>
        <AlertsFeed />
      </div>
    </div>
  );
}

const TONE: Record<string, string> = { green: 'var(--green)', amber: 'var(--amber)', blue: 'var(--blue)', plum: 'var(--plum)' };

function Metric({ label, value, sub, tone }: any) {
  return (
    <div className="rz-card" style={{ padding: 14 }}>
      <div className="xs muted" style={{ textTransform: 'uppercase', letterSpacing: '.6px' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, margin: '6px 0 2px' }}>{value}</div>
      <div className="xs" style={{ color: TONE[tone] || 'var(--muted)' }}>{sub}</div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const w = 600, h = 70, pad = 3;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${pad},${h} ${line} ${w - pad},${h}`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 70, display: 'block', marginTop: 8 }}>
      <polygon points={area} fill="var(--gs)" />
      <polyline points={line} fill="none" stroke="var(--g)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={3.5} fill="var(--g)" />
    </svg>
  );
}

function StationBar({ s }: any) {
  const pct = Math.round(s.load * 100);
  const color = TONE[s.status] || 'var(--g)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0' }}>
      <div className="sm" style={{ width: 70, flex: '0 0 auto' }}>{s.name}</div>
      <div style={{ flex: 1, height: 8, borderRadius: 6, background: 'var(--s1)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 6, transition: 'width .4s' }} />
      </div>
      <div className="xs" style={{ width: 38, textAlign: 'right', color }}>{pct}%</div>
    </div>
  );
}

function PromoRow({ p }: any) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</span>
        {p.live ? <span className="rz-tag live">live</span> : <span className="rz-tag">ended</span>}
      </div>
      <div className="xs muted" style={{ marginTop: 3 }}>{p.detail}</div>
      <div className="xs" style={{ marginTop: 5, color: 'var(--green)' }}>
        {p.upliftPct != null && `+${p.upliftPct}% sales uplift`}
        {p.redemptions != null && `${p.redemptions} redemptions · ${money(p.revenueMinor || 0)} attributed`}
      </div>
    </div>
  );
}

function AlertsFeed() {
  const [feed, setFeed] = useState<{ id: number; text: string }[]>([
    { id: 0, text: ALERTS[0] },
  ]);
  const idx = useRef(1);
  useEffect(() => {
    const t = setInterval(() => {
      const text = ALERTS[idx.current % ALERTS.length];
      idx.current += 1;
      setFeed((f) => [{ id: idx.current, text }, ...f].slice(0, 6));
    }, 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="rz-card" style={{ padding: 16 }}>
      <div className="kicker" style={{ marginBottom: 10 }}>Live feed</div>
      <div>
        {feed.map((a, i) => (
          <div key={a.id} style={{ display: 'flex', gap: 9, alignItems: 'baseline', padding: '7px 0', borderBottom: '0.5px solid var(--border)', animation: i === 0 ? 'rz-in .3s ease' : undefined }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: i === 0 ? 'var(--g)' : 'var(--border2)', flex: '0 0 auto', transform: 'translateY(-1px)' }} />
            <span className="sm">{a.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Menu IQ tab ─────────────────────────────────────────────────────────────
function MenuIQ({ menu }: any) {
  const [selected, setSelected] = useState<any>(null);

  const buckets = useMemo(() => {
    const out: Record<string, any[]> = { stars: [], plowhorses: [], puzzles: [], dogs: [] };
    for (const d of menu.dishes || []) {
      const { quadrant, action } = classify(d);
      out[quadrant].push({ ...d, action });
    }
    return out;
  }, [menu]);

  return (
    <div>
      <div className="sm muted" style={{ marginBottom: 14 }}>
        Every dish placed by profit margin × popularity. Tap a dish for its recommended move.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {(['stars', 'puzzles', 'plowhorses', 'dogs'] as const).map((q) => (
          <QuadrantCard key={q} q={q} dishes={buckets[q]} selected={selected} onSelect={setSelected} />
        ))}
      </div>

      <div className="rz-card" style={{ marginTop: 16, padding: '14px 16px', minHeight: 64, display: 'flex', alignItems: 'center' }}>
        {selected ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{selected.name}</span>
              <span className="rz-pill" style={{ background: 'var(--gs)', color: 'var(--gtx)' }}>{QUADRANTS[classify(selected).quadrant].label}</span>
            </div>
            <div className="sm" style={{ marginTop: 6 }}>
              <b style={{ color: 'var(--g)', textTransform: 'capitalize' }}>{selected.action}</b> — {ACTION_COPY[selected.action]}
            </div>
          </div>
        ) : (
          <span className="sm muted">Select a dish above to see its recommended action.</span>
        )}
      </div>
    </div>
  );
}

function QuadrantCard({ q, dishes, selected, onSelect }: any) {
  const meta = QUADRANTS[q];
  return (
    <div className="rz-card" style={{ padding: 14, borderTop: `2px solid ${meta.color}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, color: meta.color }}>{meta.label}</span>
        <span className="xs muted">{dishes.length}</span>
      </div>
      <div className="xs muted" style={{ marginBottom: 10 }}>{meta.blurb}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {dishes.length === 0 && <span className="xs muted">No dishes here.</span>}
        {dishes.map((d: any) => {
          const on = selected?.id === d.id;
          return (
            <button key={d.id} onClick={() => onSelect(d)} style={{
              fontSize: 12, padding: '6px 11px', borderRadius: 20, cursor: 'pointer',
              border: `0.5px solid ${on ? 'var(--g)' : 'var(--border)'}`,
              background: on ? 'var(--g)' : 'var(--surface)',
              color: on ? '#fff' : 'var(--ink)',
            }}>{d.name}</button>
          );
        })}
      </div>
    </div>
  );
}
