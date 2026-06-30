import React, { useEffect, useMemo, useState } from 'react';
import {
  waiterApi, normalizeRequests, normalizeFloor, normalizeServeQueue, moveVerb,
  type Req, type Table, type ServeTicket,
} from './api';

/* Waiter handheld — the floor-runner surface. Psychology baked in:
   - overwhelm -> focus: ONE ranked feed of what to do next, not a list of lists.
   - the single most-urgent card is visually isolated (thick brass border + tint)
     so the eye lands on the next action with zero scanning (Hick's law).
   - one-tap primary action per card (large touch target, one-handed); on success
     the card animates out and the next surfaces (peak-end + momentum).
   - live aging via setInterval so urgency re-ranks itself in real time.
   - positive empty state — calm, not blank.
   - Floor tab: status-coloured table tiles + Sheet to move/swap, with a plain
     confirmation line stating exactly what happened (closure). */

// ---- Service-request presentation ----
const REQ_LABEL: Record<string, string> = {
  call: 'Wants the waiter', water: 'Asking for water',
  bill: 'Ready for the bill', cutlery: 'Cutlery / napkins',
};
const REQ_ICON: Record<string, string> = { call: '🙋', water: '💧', bill: '🧾', cutlery: '🍴' };

// ---- Floor status palette (maps to CSS-var semantic colours) ----
const STATUS = ['free', 'seated', 'cooking', 'ready', 'billing'] as const;
const STATUS_COLOR: Record<string, string> = {
  free: 'var(--muted)', seated: 'var(--blue)', cooking: 'var(--amber)',
  ready: 'var(--green)', billing: 'var(--plum)',
};
const STATUS_LABEL: Record<string, string> = {
  free: 'Free', seated: 'Seated', cooking: 'Cooking', ready: 'Ready to serve', billing: 'Billing',
};

const POLL_MS = 7000;
const AGE_TICK_MS = 1000;

// A unified feed item: a service request, or a "serve" prompt for ONE ready
// ticket (per order). Serve items come from the /serve-queue, keyed by ticketId,
// so two ready rounds at the same table are two cards and serving one leaves
// the other.
type FeedItem = {
  key: string;
  kind: 'request' | 'serve';
  table: number;
  title: string;
  subtitle?: string;
  icon: string;
  since: number;      // epoch ms the item started waiting
  escalated: boolean; // hard-urgent (unowned / overdue request)
  rank: number;       // higher = more urgent
  req?: Req;
  ticketId?: string;
};

function buildFeed(reqs: Req[], serves: ServeTicket[]): FeedItem[] {
  const items: FeedItem[] = [];
  for (const r of reqs) {
    const esc = r.state === 'escalated';
    items.push({
      key: 'req_' + r.id,
      kind: 'request',
      table: r.table,
      title: REQ_LABEL[r.type] || 'Service request',
      icon: REQ_ICON[r.type] || '🔔',
      since: r.createdAt,
      escalated: esc,
      // bill > escalated boost; older = more urgent; serve items rank below open requests
      rank: 2000 + (esc ? 1000 : 0) + (r.type === 'bill' ? 200 : 0),
      req: r,
    });
  }
  for (const s of serves) {
    items.push({
      key: 'serve_' + s.ticketId,
      kind: 'serve',
      table: s.table,
      title: 'Food is ready to serve',
      subtitle: s.dishes.slice(0, 4).join(', ') + (s.dishes.length > 4 ? '…' : ''),
      icon: '🍽️',
      since: s.readyAt,
      escalated: false,
      rank: 1500,
      ticketId: s.ticketId,
    });
  }
  // most urgent first: rank desc, then oldest first
  return items.sort((a, b) => b.rank - a.rank || a.since - b.since);
}

function ageLabel(since: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  return `${m}m ${secs % 60}s`;
}

export default function Waiter() {
  const [tab, setTab] = useState<'now' | 'floor'>('now');
  const [reqs, setReqs] = useState<Req[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [serves, setServes] = useState<ServeTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [leaving, setLeaving] = useState<Record<string, boolean>>({}); // animate-out keys
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState('');
  const [sheetTable, setSheetTable] = useState<Table | null>(null);

  function flash(m: string) { setToast(m); window.setTimeout(() => setToast(''), 2400); }

  async function refresh(initial = false) {
    if (initial) { setLoading(true); setError(null); }
    try {
      // Ask the BFF to escalate overdue requests first, then read the fresh state:
      // open requests, the ready-ticket serve queue, and the derived floor map.
      try { await waiterApi.escalateDue(Date.now()); } catch { /* non-fatal */ }
      const [rRes, sRes, fRes] = await Promise.all([
        waiterApi.getRequests(), waiterApi.getServeQueue(), waiterApi.getFloor(),
      ]);
      setReqs(normalizeRequests(rRes));
      setServes(normalizeServeQueue(sRes));
      setTables(normalizeFloor(fRes));
      setError(null);
    } catch (e: any) {
      if (initial) setError(e?.message || 'Could not reach the floor');
    } finally {
      if (initial) setLoading(false);
    }
  }

  useEffect(() => {
    refresh(true);
    // Poll only while the tab is visible so we don't stream network calls in the
    // background; the local age-tick keeps running (it makes no network call).
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh(false);
    }, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(false); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(poll); window.clearInterval(tick); document.removeEventListener('visibilitychange', onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const feed = useMemo(() => {
    const items = buildFeed(reqs, serves);
    // drop ones currently animating out so the next surfaces visually
    return items.filter((it) => !leaving[it.key]);
  }, [reqs, serves, leaving]);

  async function actOn(it: FeedItem) {
    if (busy[it.key]) return;
    setBusy((b) => ({ ...b, [it.key]: true }));
    // optimistic animate-out
    setLeaving((l) => ({ ...l, [it.key]: true }));
    try {
      if (it.kind === 'request' && it.req) {
        await waiterApi.ackRequest(it.req.id);
        // optimistic local removal
        setReqs((rs) => rs.filter((r) => r.id !== it.req!.id));
        flash(`Acknowledged · Table ${it.table}`);
      } else if (it.ticketId) {
        // Deliver THIS ticket (one order). Other rounds at the same table are
        // separate cards and stay until they're each served.
        await waiterApi.serveTicket(it.ticketId);
        setServes((ss) => ss.filter((s) => s.ticketId !== it.ticketId));
        flash(`Served · Table ${it.table}`);
      }
      // reconcile with server shortly after
      window.setTimeout(() => refresh(false), 400);
    } catch (e: any) {
      // rollback the animate-out on failure
      setLeaving((l) => { const n = { ...l }; delete n[it.key]; return n; });
      flash(e?.message || 'Could not complete — try again');
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[it.key]; return n; });
    }
  }

  async function doMove(src: number, dst: number) {
    try {
      const res = await waiterApi.moveTable(src, dst);
      const verb = moveVerb(res);
      setTables(normalizeFloor(res)); // BFF returns the updated floor
      setSheetTable(null);
      flash(verb === 'swapped' ? `Swapped Table ${src} ↔ Table ${dst}` : `Moved Table ${src} → Table ${dst}`);
      window.setTimeout(() => refresh(false), 300);
    } catch (e: any) {
      flash(e?.message || 'Move not allowed');
    }
  }

  const openCount = reqs.length;
  const readyCount = tables.filter((t) => t.status === 'ready').length;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 80, minHeight: '100%' }}>
      <Header openCount={openCount} readyCount={readyCount} />
      <Tabs tab={tab} setTab={setTab} pending={feed.length} occupied={tables.filter((t) => t.status !== 'free').length} />

      {tab === 'now' && (
        <div style={{ padding: '10px 14px' }}>
          {loading && <div className="rz-empty">Reading the floor…</div>}
          {error && !loading && (
            <div className="rz-empty" style={{ color: 'var(--red)' }}>
              {error}<br />
              <button className="rz-ghost" style={{ marginTop: 12 }} onClick={() => refresh(true)}>Retry</button>
            </div>
          )}
          {!loading && !error && feed.length === 0 && (
            <div className="rz-empty"><span className="ic">✓</span>Floor is calm — nothing waiting.</div>
          )}
          {!loading && !error && feed.map((it, i) => (
            <FeedCard
              key={it.key}
              it={it}
              top={i === 0}
              now={now}
              busy={!!busy[it.key]}
              onAct={() => actOn(it)}
            />
          ))}
        </div>
      )}

      {tab === 'floor' && (
        <div style={{ padding: '10px 14px' }}>
          {loading && <div className="rz-empty">Loading the floor plan…</div>}
          {error && !loading && (
            <div className="rz-empty" style={{ color: 'var(--red)' }}>
              {error}<br />
              <button className="rz-ghost" style={{ marginTop: 12 }} onClick={() => refresh(true)}>Retry</button>
            </div>
          )}
          {!loading && !error && tables.length === 0 && <div className="rz-empty">No tables on this floor yet.</div>}
          {!loading && !error && tables.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {tables.map((t) => (
                  <TableTile key={t.n} t={t} onTap={() => t.status !== 'free' && setSheetTable(t)} />
                ))}
              </div>
              <Legend />
            </>
          )}
        </div>
      )}

      {sheetTable && (
        <MoveSheet
          src={sheetTable}
          tables={tables}
          onClose={() => setSheetTable(null)}
          onMove={(dst) => doMove(sheetTable.n, dst)}
        />
      )}

      <div className={'rz-toast' + (toast ? ' show' : '')}>{toast}</div>
    </div>
  );
}

function Header({ openCount, readyCount }: any) {
  return (
    <div style={{ padding: '15px 16px 12px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div className="kicker">Service</div>
        <div style={{ fontSize: 19, fontWeight: 600 }}>Your floor</div>
        <div className="xs muted" style={{ marginTop: 2 }}>
          {openCount ? `${openCount} waiting` : 'All caught up'}{readyCount ? ` · ${readyCount} to serve` : ''}
        </div>
      </div>
      <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--gs)', color: 'var(--g)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🧑‍🍳</div>
    </div>
  );
}

function Tabs({ tab, setTab, pending, occupied }: any) {
  const item = (id: 'now' | 'floor', label: string, badge: number) => {
    const on = tab === id;
    return (
      <button onClick={() => setTab(id)} style={{
        flex: 1, padding: '12px 0', border: 'none', background: 'transparent', cursor: 'pointer',
        fontSize: 14, fontWeight: 600, color: on ? 'var(--g)' : 'var(--muted)',
        borderBottom: `2px solid ${on ? 'var(--g)' : 'transparent'}`,
      }}>
        {label}{badge ? <span style={{ marginLeft: 6, fontSize: 11, background: on ? 'var(--g)' : 'var(--border2)', color: '#fff', borderRadius: 20, padding: '1px 7px' }}>{badge}</span> : null}
      </button>
    );
  };
  return (
    <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 5 }}>
      {item('now', 'Now', pending)}
      {item('floor', 'Floor', occupied)}
    </div>
  );
}

function FeedCard({ it, top, now, busy, onAct }: { it: FeedItem; top: boolean; now: number; busy: boolean; onAct: () => void }) {
  const accent = it.escalated ? 'var(--red)' : top ? 'var(--g)' : 'var(--border2)';
  const isServe = it.kind === 'serve';
  const cta = isServe ? 'Serve' : it.escalated ? 'Acknowledge' : 'Acknowledge';
  return (
    <div
      className="rz-card"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px 14px 14px',
        marginBottom: 10, overflow: 'hidden',
        borderLeft: `${top ? 6 : 3}px solid ${accent}`,
        background: top ? (it.escalated ? '#FBEEEE' : 'var(--gs)') : 'var(--surface)',
        boxShadow: top ? 'var(--shadow)' : undefined,
        animation: 'rz-in .25s ease',
      }}
    >
      <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flex: '0 0 auto' }}>{it.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Table {it.table}</span>
          {it.escalated && <span className="rz-pill" style={{ background: '#F6DADA', color: 'var(--red)', fontWeight: 600 }}>Overdue</span>}
          {top && !it.escalated && <span className="rz-pill" style={{ background: 'var(--g)', color: '#fff', fontWeight: 600 }}>Next</span>}
        </div>
        <div className="sm" style={{ marginTop: 2 }}>{it.title}</div>
        {it.subtitle && <div className="xs" style={{ marginTop: 2, fontWeight: 600 }}>{it.subtitle}</div>}
        <div className="xs muted" style={{ marginTop: 3, color: it.escalated ? 'var(--red)' : 'var(--muted)' }}>
          waiting {ageLabel(it.since, now)}
        </div>
      </div>
      <button
        onClick={onAct}
        disabled={busy}
        style={{
          flex: '0 0 auto', border: 'none', borderRadius: 14, cursor: busy ? 'default' : 'pointer',
          padding: '0 18px', height: 52, minWidth: 96, fontSize: 15, fontWeight: 700, color: '#fff',
          background: isServe ? 'var(--green)' : it.escalated ? 'var(--red)' : 'var(--g)',
          opacity: busy ? 0.6 : 1, transition: 'transform .1s',
        }}
      >
        {busy ? '…' : cta}
      </button>
    </div>
  );
}

function TableTile({ t, onTap }: { t: Table; onTap: () => void }) {
  const color = STATUS_COLOR[t.status] || 'var(--muted)';
  const free = t.status === 'free';
  return (
    <button
      onClick={onTap}
      disabled={free}
      style={{
        aspectRatio: '1 / 1', borderRadius: 16, cursor: free ? 'default' : 'pointer',
        border: `1px solid ${free ? 'var(--border)' : color}`,
        background: free ? 'var(--s1)' : 'var(--surface)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 4, padding: 8, position: 'relative', opacity: free ? 0.7 : 1,
      }}
    >
      <span style={{ position: 'absolute', top: 8, right: 8, width: 9, height: 9, borderRadius: '50%', background: color }} />
      <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)' }}>{t.n}</span>
      <span className="xs" style={{ color, fontWeight: 600 }}>{STATUS_LABEL[t.status] || t.status}</span>
      {t.waiterId && <span className="xs muted" style={{ fontSize: 9.5 }}>{prettyWaiter(t.waiterId)}</span>}
    </button>
  );
}

function prettyWaiter(id: string) {
  // 'w_ramesh' -> 'Ramesh'
  const base = id.replace(/^w_/, '');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function Legend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16, padding: '12px 4px 0', borderTop: '0.5px solid var(--border)' }}>
      {STATUS.map((s) => (
        <span key={s} className="xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: STATUS_COLOR[s], display: 'inline-block' }} />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

function MoveSheet({ src, tables, onClose, onMove }: { src: Table; tables: Table[]; onClose: () => void; onMove: (dst: number) => void }) {
  const others = tables.filter((t) => t.n !== src.n);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(33,30,24,.35)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 40 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '16px 18px 24px', animation: 'rz-in .25s ease' }}>
        <div className="kicker" style={{ marginBottom: 4 }}>Move or swap</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>Table {src.n} · {STATUS_LABEL[src.status] || src.status}</div>
        <div className="xs muted" style={{ marginBottom: 12 }}>
          Pick a destination. A free table <b>moves</b> this party; an occupied one <b>swaps</b> the two.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 9, maxHeight: 280, overflow: 'auto' }}>
          {others.map((t) => {
            const free = t.status === 'free';
            const color = STATUS_COLOR[t.status] || 'var(--muted)';
            return (
              <button key={t.n} onClick={() => onMove(t.n)} style={{
                borderRadius: 14, border: `1px solid ${free ? 'var(--border)' : color}`,
                background: free ? 'var(--s1)' : 'var(--surface)', cursor: 'pointer',
                padding: '12px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{t.n}</span>
                <span className="xs" style={{ color: free ? 'var(--g)' : color, fontWeight: 600 }}>{free ? 'Move here' : 'Swap'}</span>
              </button>
            );
          })}
        </div>
        <button className="rz-ghost" style={{ marginTop: 14 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
