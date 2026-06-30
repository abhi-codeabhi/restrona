import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  kitchenApi,
  normalizeBoard,
  deriveAllDay,
  nextStatus,
  KdsTicket,
  KdsItem,
  ItemStatus,
} from './api';

/* Kitchen Display System (KDS) — the line cook's surface. Psychology baked in:
   - glanceable from across the room: big type, color-coded status, minimal chrome
   - one tap advances an item (new -> preparing -> ready); one tap bumps the ticket
   - all-day rail across the top: how many of each dish are still to cook
   - aging cue: older tickets warm then escalate to red, so nothing gets forgotten
   - a kitchen-load gauge frames the pace
   - optimistic UI: the tap lands instantly, then the board refetches to reconcile
   - reward completion: a clear, calm "All caught up — the line is clear" empty state */

const POLL_MS = 3000;
const STATION_COLORS: Record<string, string> = {
  grill: 'var(--red)',
  tandoor: 'var(--amber)',
  fry: 'var(--g)',
  saute: 'var(--plum)',
  cold: 'var(--blue)',
  salad: 'var(--green)',
  pass: 'var(--rose)',
  kitchen: 'var(--muted)',
};
const stationColor = (s: string) => STATION_COLORS[s] || 'var(--muted)';

const STATUS_META: Record<ItemStatus, { label: string; bg: string; fg: string }> = {
  new: { label: 'New', bg: 'var(--s1)', fg: 'var(--muted)' },
  preparing: { label: 'Preparing', bg: '#FBEFD9', fg: '#8a5a14' },
  ready: { label: 'Ready', bg: '#E6EFE8', fg: 'var(--green)' },
};

// Aging thresholds (ms) → visual escalation of a ticket that isn't done yet.
const AGE_WARN = 6 * 60 * 1000; // 6 min
const AGE_LATE = 12 * 60 * 1000; // 12 min

export default function Kitchen() {
  const [tickets, setTickets] = useState<KdsTicket[]>([]);
  const [allDay, setAllDay] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState('');
  const busy = useRef<Set<string>>(new Set()); // in-flight mutation keys, to dim taps

  function flash(m: string) {
    setToast(m);
    setTimeout(() => setToast(''), 2000);
  }

  async function refresh(initial = false) {
    if (initial) setLoading(true);
    try {
      const board = normalizeBoard(await kitchenApi.getBoard());
      setTickets(board);
      // Prefer the dedicated all-day endpoint; fall back to deriving from the board.
      try {
        const ad = await kitchenApi.getAllDay();
        setAllDay(ad && typeof ad === 'object' && !Array.isArray(ad) ? ad : deriveAllDay(board));
      } catch {
        setAllDay(deriveAllDay(board));
      }
      setError(null);
    } catch (e: any) {
      // Never crash on a poll blip — surface a small inline message, keep last board.
      setError(e?.message || 'Lost the board — retrying…');
    } finally {
      if (initial) setLoading(false);
    }
  }

  // Initial load + 3s poll of the board (cleared on unmount).
  useEffect(() => {
    refresh(true);
    const poll = setInterval(() => refresh(false), POLL_MS);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ticking clock so the aging cues advance without a network call.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Optimistically advance a single item, then reconcile with the BFF.
  async function advance(t: KdsTicket, it: KdsItem) {
    if (it.status === 'ready') return;
    const key = t.id + ':' + it.index;
    busy.current.add(key);
    const target = nextStatus(it.status);
    setTickets((prev) => patchItem(prev, t.id, it.index, target));
    try {
      await kitchenApi.advanceItem(t.id, it.index);
      if (target === 'ready') flash('Ready: ' + it.name);
      await refresh(false);
    } catch (e: any) {
      setError(e?.message || 'Could not advance — reverting');
      await refresh(false); // server is source of truth; reconcile away the optimistic change
    } finally {
      busy.current.delete(key);
    }
  }

  // Optimistically bump the whole ticket to ready, then reconcile.
  async function bump(t: KdsTicket) {
    const key = t.id + ':bump';
    busy.current.add(key);
    setTickets((prev) =>
      prev.map((x) =>
        x.id === t.id
          ? { ...x, items: x.items.map((i) => ({ ...i, status: 'ready' as ItemStatus })), done: true }
          : x,
      ),
    );
    try {
      await kitchenApi.bumpTicket(t.id);
      flash('Bumped ' + (t.table ? 'Table ' + t.table : t.id));
      await refresh(false);
    } catch (e: any) {
      setError(e?.message || 'Could not bump — reverting');
      await refresh(false);
    } finally {
      busy.current.delete(key);
    }
  }

  // Active board excludes fully-bumped tickets so the line stays glanceable.
  const board = useMemo(() => tickets.filter((t) => t.items.length > 0 && !t.done), [tickets]);
  const allDayEntries = useMemo(
    () => Object.entries(allDay).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]),
    [allDay],
  );

  // Kitchen load: open items + how many tickets are aging late.
  const openItems = board.reduce((n, t) => n + t.items.filter((i) => i.status !== 'ready').length, 0);
  const lateCount = board.filter((t) => t.receivedAt && now - t.receivedAt > AGE_LATE).length;
  const load = loadLevel(openItems, lateCount);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '16px 18px 40px' }}>
      <Header load={load} openItems={openItems} ticketCount={board.length} lateCount={lateCount} />

      <AllDayRail entries={allDayEntries} />

      {error && (
        <div className="rz-card" style={{ padding: '10px 14px', margin: '12px 0', color: 'var(--red)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button className="rz-ghost" style={{ width: 'auto', padding: '6px 14px' }} onClick={() => refresh(false)}>Retry</button>
        </div>
      )}

      {loading && <div className="rz-empty" style={{ marginTop: 14 }}>Lighting the stoves…</div>}

      {!loading && board.length === 0 && (
        <div className="rz-empty" style={{ marginTop: 18, padding: '52px 0' }}>
          <span className="ic">✓</span>
          All caught up — the line is clear.
          <div className="xs muted" style={{ marginTop: 6 }}>New tickets will appear here the moment they fire.</div>
        </div>
      )}

      {!loading && board.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
            marginTop: 16,
            alignItems: 'start',
          }}
        >
          {board.map((t) => (
            <TicketCard
              key={t.id}
              t={t}
              now={now}
              busy={busy.current}
              onAdvance={(it) => advance(t, it)}
              onBump={() => bump(t)}
            />
          ))}
        </div>
      )}

      <div className={'rz-toast' + (toast ? ' show' : '')}>{toast}</div>
    </div>
  );
}

/* ---- Header + kitchen-load gauge ---- */
function Header({ load, openItems, ticketCount, lateCount }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingBottom: 12, borderBottom: '0.5px solid var(--border)' }}>
      <div>
        <div className="kicker">Expo line · Kitchen Display</div>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.4 }}>The Pass</div>
        <div className="sm muted" style={{ marginTop: 3 }}>
          {ticketCount} open ticket{ticketCount === 1 ? '' : 's'} · {openItems} item{openItems === 1 ? '' : 's'} to cook
          {lateCount ? <span style={{ color: 'var(--red)', fontWeight: 600 }}> · {lateCount} running late</span> : null}
        </div>
      </div>
      <LoadGauge load={load} />
    </div>
  );
}

function LoadGauge({ load }: { load: { level: string; pct: number; color: string } }) {
  return (
    <div style={{ minWidth: 200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span className="xs muted">Kitchen load</span>
        <span className="xs" style={{ color: load.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{load.level}</span>
      </div>
      <div style={{ height: 8, borderRadius: 20, background: 'var(--s1)', border: '0.5px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: load.pct + '%', background: load.color, borderRadius: 20, transition: 'width .5s ease, background .5s ease' }} />
      </div>
    </div>
  );
}

/* ---- All-day rail: live counts of each dish still to cook ---- */
function AllDayRail({ entries }: { entries: [string, number][] }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div className="kicker" style={{ marginBottom: 6 }}>All day · still to cook</div>
      {entries.length === 0 ? (
        <div className="sm muted" style={{ padding: '6px 0' }}>Nothing queued — every dish is plated.</div>
      ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {entries.map(([name, n]) => (
            <div key={name} className="rz-card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 8px 10px' }}>
              <span style={{ minWidth: 30, height: 30, borderRadius: 9, background: 'var(--ink)', color: '#fff', fontSize: 16, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>{n}</span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- A single ticket card ---- */
function TicketCard({ t, now, busy, onAdvance, onBump }: any) {
  const age = t.receivedAt ? now - t.receivedAt : 0;
  const escalate = t.receivedAt ? (age > AGE_LATE ? 'late' : age > AGE_WARN ? 'warn' : 'fresh') : 'fresh';
  const accent = escalate === 'late' ? 'var(--red)' : escalate === 'warn' ? 'var(--amber)' : 'var(--border)';
  const readyCount = t.items.filter((i: KdsItem) => i.status === 'ready').length;
  const allReady = readyCount === t.items.length && t.items.length > 0;

  return (
    <div
      className="rz-card"
      style={{
        padding: 0,
        overflow: 'hidden',
        borderTop: `3px solid ${accent}`,
        boxShadow: escalate === 'late' ? '0 0 0 1.5px var(--red)' : 'var(--shadow)',
        animation: escalate === 'late' ? 'rz-pulse-late 2s ease-in-out infinite' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px 10px', borderBottom: '0.5px solid var(--border)' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>{t.table ? 'Table ' + t.table : t.id}</div>
          {t.orderId && <div className="xs muted">#{t.orderId}</div>}
        </div>
        <AgeChip age={age} escalate={escalate} hasTime={!!t.receivedAt} />
      </div>

      <div style={{ padding: '6px 8px' }}>
        {t.items.map((it: KdsItem) => {
          const key = t.id + ':' + it.index;
          const isBusy = busy.has(key) || busy.has(t.id + ':bump');
          return (
            <ItemRow key={it.index} it={it} disabled={isBusy} onTap={() => onAdvance(it)} />
          );
        })}
      </div>

      <div style={{ padding: '8px 12px 12px' }}>
        <button
          className="rz-cta"
          style={{ background: allReady ? 'var(--green)' : 'var(--g)', fontSize: 14 }}
          onClick={onBump}
        >
          {allReady ? '✓ Bump · all ready' : `Mark all ready · Bump (${readyCount}/${t.items.length})`}
        </button>
      </div>
    </div>
  );
}

function ItemRow({ it, onTap, disabled }: { it: KdsItem; onTap: () => void; disabled: boolean }) {
  const meta = STATUS_META[it.status];
  const done = it.status === 'ready';
  return (
    <button
      onClick={onTap}
      disabled={disabled || done}
      aria-label={`${it.name} — ${meta.label}${done ? '' : ', tap to advance'}`}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        borderRadius: 10,
        padding: '11px 8px',
        cursor: done ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'opacity .2s',
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: '50%', flex: '0 0 auto', background: stationColor(it.station) }} title={it.station} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, color: done ? 'var(--muted)' : 'var(--ink)', textDecoration: done ? 'line-through' : 'none' }}>
        {it.name}
        <span className="xs muted" style={{ display: 'block', fontWeight: 400, textTransform: 'capitalize', marginTop: 1 }}>{it.station}</span>
      </span>
      <span className="rz-pill" style={{ background: meta.bg, color: meta.fg, fontWeight: 600, flex: '0 0 auto' }}>{meta.label}</span>
    </button>
  );
}

function AgeChip({ age, escalate, hasTime }: { age: number; escalate: string; hasTime: boolean }) {
  if (!hasTime) return null;
  const color = escalate === 'late' ? 'var(--red)' : escalate === 'warn' ? 'var(--amber)' : 'var(--muted)';
  return (
    <span className="rz-pill" style={{ background: 'var(--s1)', border: '0.5px solid var(--border)', color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
      {fmtAge(age)}
    </span>
  );
}

/* ---- helpers ---- */
function patchItem(prev: KdsTicket[], ticketId: string, index: number, status: ItemStatus): KdsTicket[] {
  return prev.map((t) => {
    if (t.id !== ticketId) return t;
    const items = t.items.map((i) => (i.index === index ? { ...i, status } : i));
    return { ...t, items, done: items.length > 0 && items.every((i) => i.status === 'ready') };
  });
}

function loadLevel(openItems: number, lateCount: number) {
  if (lateCount > 0 || openItems >= 12) return { level: 'Slammed', pct: 100, color: 'var(--red)' };
  if (openItems >= 6) return { level: 'Busy', pct: 66, color: 'var(--amber)' };
  if (openItems >= 1) return { level: 'Steady', pct: 34, color: 'var(--green)' };
  return { level: 'Clear', pct: 8, color: 'var(--green)' };
}

function fmtAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

// Keep-alive: a late-ticket pulse keyframe injected once (no foundation files touched).
if (typeof document !== 'undefined' && !document.getElementById('rz-kds-kf')) {
  const el = document.createElement('style');
  el.id = 'rz-kds-kf';
  el.textContent =
    '@keyframes rz-pulse-late{0%,100%{box-shadow:0 0 0 1.5px var(--red)}50%{box-shadow:0 0 0 3px rgba(178,58,72,.35)}}';
  document.head.appendChild(el);
}
