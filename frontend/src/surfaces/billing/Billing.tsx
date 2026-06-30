import React, { useEffect, useMemo, useState } from 'react';
import {
  billingApi, normalizeTabs, normalizeBillDetail, normalizeTableOrders, sectionsOf,
  type Tab,
} from './api';
import { money } from '../../lib/format';

/* Billing agent surface. The board lists EVERY occupied table from its first
   order with a live running total — the agent tracks tables as they fill and
   generates/settles any of them, not only the ones that asked. Psychology:
   - one ranked board, status-tinted, so 20 tables stay scannable;
   - the settle screen reads like the printed bill (grouped by course);
   - one brass primary action; a clear "Paid" closure. */

const POLL_MS = 6000;
const METHODS = [{ id: 'upi', label: 'UPI' }, { id: 'card', label: 'Card' }, { id: 'cash', label: 'Cash' }];

const STATUS_UI: Record<string, { label: string; color: string; tint: string }> = {
  open: { label: 'Open tab', color: 'var(--muted)', tint: 'var(--surface)' },
  asked: { label: 'Asked for the bill', color: 'var(--amber)', tint: '#FBF6EC' },
  bill_ready: { label: 'Bill ready', color: 'var(--g)', tint: 'var(--gs)' },
};

export default function Billing() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  function flash(m: string) { setToast(m); window.setTimeout(() => setToast(''), 2400); }

  async function refresh(initial = false) {
    if (initial) { setLoading(true); setError(null); }
    try { setTabs(normalizeTabs(await billingApi.getOpenTabs())); setError(null); }
    catch (e: any) { if (initial) setError(e?.message || 'Could not load the billing board'); }
    finally { if (initial) setLoading(false); }
  }

  useEffect(() => {
    refresh(true);
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible' && sel == null) refresh(false); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(false); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(poll); document.removeEventListener('visibilitychange', onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  // Asked-first, then open tabs, then already-billed; each ascending by table.
  const queue = useMemo(() => {
    const rank = (t: Tab) => (t.status === 'asked' ? 0 : t.status === 'open' ? 1 : 2);
    return [...tabs].sort((a, b) => rank(a) - rank(b) || a.table - b.table);
  }, [tabs]);

  if (sel != null) {
    const tab = tabs.find((t) => t.table === sel) || ({ table: sel, billId: null } as Tab);
    return <Settle tab={tab} onDone={() => { setSel(null); refresh(false); }} flash={flash} toast={toast} />;
  }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '0 16px 60px' }}>
      <div style={{ padding: '18px 0 12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div><div className="kicker">Billing</div><div style={{ fontSize: 21, fontWeight: 600 }}>Open tables</div></div>
        <div className="xs muted">{queue.length} active</div>
      </div>

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }} aria-busy="true" aria-label="Loading the billing board">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rz-card" style={{ padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="rz-skel" style={{ height: 18, width: '60%' }} />
              <div className="rz-skel" style={{ height: 12, width: '45%' }} />
              <div className="rz-skel" style={{ height: 11, width: '70%' }} />
            </div>
          ))}
        </div>
      )}
      {!loading && error && <div className="rz-empty" style={{ color: 'var(--red)' }}>{error}<br />
        <button className="rz-ghost" style={{ marginTop: 12, width: 'auto', padding: '0 16px' }} onClick={() => refresh(true)}>Retry</button></div>}
      {!loading && !error && queue.length === 0 && <div className="rz-empty">No open tables right now.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
        {queue.map((t) => {
          const ui = STATUS_UI[t.status];
          const amount = t.status === 'bill_ready' ? t.billTotalMinor : t.runningMinor;
          return (
            <button key={t.table} onClick={() => setSel(t.table)} className="rz-card rz-tap"
              aria-label={`Table ${t.table}, ${ui.label}, ${money(amount)}`}
              style={{ padding: '13px 14px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 7, borderLeft: `4px solid ${ui.color}`, background: ui.tint }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 18 }}>Table {t.table}</span>
                <span className="rz-num" style={{ fontWeight: 700, fontSize: 15 }}>{money(amount)}</span>
              </div>
              <span className="rz-pill xs" style={{ alignSelf: 'flex-start', color: ui.color, fontWeight: 700, background: 'rgba(255,255,255,.55)', border: `0.5px solid ${ui.color}33` }}>{ui.label}</span>
              <span className="xs muted">{t.orderCount} order{t.orderCount === 1 ? '' : 's'} · {t.itemCount} item{t.itemCount === 1 ? '' : 's'}</span>
            </button>
          );
        })}
      </div>
      <div className={'rz-toast' + (toast ? ' show' : '')}>{toast}</div>
    </div>
  );
}

function Settle({ tab, onDone, flash, toast }: any) {
  const [billId, setBillId] = useState<string | null>(tab.billId || null);
  const [lines, setLines] = useState<{ name: string; category: string; priceMinor: number }[]>([]);
  const [totalMinor, setTotalMinor] = useState<number>(tab.billTotalMinor || 0);
  const [orders, setOrders] = useState<any[]>([]);
  const [coupon, setCoupon] = useState('');
  const [method, setMethod] = useState('upi');
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadBill(id: string) {
    const d = normalizeBillDetail(await billingApi.getBill(id));
    setLines(d.lines); setTotalMinor(d.totalMinor);
  }

  useEffect(() => {
    (async () => {
      try {
        if (billId) await loadBill(billId);
        else setOrders(normalizeTableOrders(await billingApi.getTableOrders(tab.table)));
      } catch (e: any) { flash(e?.message || 'Could not load the table'); }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewMinor = useMemo(
    () => orders.reduce((s, o) => s + o.lines.reduce((x: number, l: any) => x + l.priceMinor * l.qty, 0), 0),
    [orders],
  );
  const sections = useMemo(() => sectionsOf(lines), [lines]);

  async function generate() {
    setBusy(true);
    try {
      const r = await billingApi.openTableBill(tab.table);
      setBillId(r.bill.id);
      await loadBill(r.bill.id);
      flash('Bill generated');
    } catch (e: any) { flash(e?.message || 'No open orders to bill'); }
    finally { setBusy(false); }
  }

  async function applyCoupon() {
    if (!billId || !coupon.trim()) return;
    try {
      const subtotal = lines.reduce((s, l) => s + l.priceMinor, 0);
      const q = await billingApi.quote(subtotal, coupon.trim());
      if (q?.discountMinor > 0) {
        const r = await billingApi.applyDiscount(billId, q.discountMinor, coupon.trim());
        setTotalMinor(r.totals?.total?.minor ?? totalMinor);
        flash(`Coupon applied · −${money(q.discountMinor)}`);
      } else flash('Coupon not valid for this bill');
    } catch (e: any) { flash(e?.message || 'Coupon rejected'); }
  }

  async function takePayment() {
    if (!billId) return;
    setBusy(true);
    try {
      const r = await billingApi.pay(billId, method, totalMinor);
      if (r?.paid) setPaid(true); else flash('Payment recorded (partial)');
    } catch (e: any) { flash(e?.message || 'Could not take payment'); }
    finally { setBusy(false); }
  }

  if (paid) {
    return (
      <div style={{ maxWidth: 460, margin: '0 auto', padding: '52px 18px', textAlign: 'center' }} role="status">
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#E6EFE8', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 16px', animation: 'rz-pop .4s ease' }} aria-hidden="true">✓</div>
        <h2 style={{ fontSize: 19, margin: 0 }}>Paid · Table {tab.table}</h2>
        <div className="rz-num" style={{ fontSize: 28, fontWeight: 700, marginTop: 10 }}>{money(totalMinor)}</div>
        <div className="sm muted" style={{ marginTop: 4 }}>Settled by {METHODS.find((m) => m.id === method)?.label}</div>
        <div className="rz-tag live" style={{ marginTop: 14, display: 'inline-block' }}>Table is now free</div>
        <button className="rz-cta" style={{ marginTop: 26 }} onClick={onDone}>Back to board</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 60px' }}>
      <div style={{ padding: '16px 0 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="rz-ghost" style={{ width: 'auto', padding: '0 14px' }} onClick={onDone} aria-label="Back to board">← Board</button>
        <div><div className="kicker">Settle</div><div style={{ fontSize: 20, fontWeight: 600 }}>Table {tab.table}</div></div>
      </div>

      {loading && (
        <div className="rz-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} aria-busy="true" aria-label="Loading the table">
          {[0, 1, 2].map((i) => <div key={i} className="rz-skel" style={{ height: 14, width: `${85 - i * 12}%` }} />)}
          <div className="rz-skel" style={{ height: 46, width: '100%', marginTop: 6 }} />
        </div>
      )}

      {!loading && !billId && (
        <div className="rz-card" style={{ padding: 16 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Running orders</div>
          {orders.length === 0 && <div className="xs muted">No unbilled orders for this table.</div>}
          {orders.map((o, i) => (
            <div key={o.id} style={{ padding: '6px 0', borderBottom: i < orders.length - 1 ? '0.5px solid var(--border)' : undefined }}>
              {o.lines.map((l: any, j: number) => (
                <div key={j} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '2px 0' }}>
                  <span>{l.qty}× {l.name}</span><span className="rz-num">{money(l.priceMinor * l.qty)}</span>
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontWeight: 600, marginTop: 12, paddingTop: 10, borderTop: '0.5px solid var(--border)' }}>
            <span className="muted">Est. subtotal</span><span className="rz-num" style={{ fontSize: 16 }}>{money(previewMinor)}</span>
          </div>
          <button className="rz-cta" style={{ marginTop: 14 }} disabled={busy || orders.length === 0} onClick={generate}>
            {busy ? 'Generating…' : 'Generate final bill'}
          </button>
          <div className="xs muted" style={{ textAlign: 'center', marginTop: 8 }}>GST is added on the final bill</div>
        </div>
      )}

      {!loading && billId && (
        <div className="rz-card" style={{ padding: 16 }}>
          <div className="kicker" style={{ marginBottom: 10 }}>Final bill · Table {tab.table}</div>
          {sections.map((s) => (
            <div key={s.category} style={{ marginBottom: 12 }}>
              <div className="xs muted" style={{ fontWeight: 600, marginBottom: 4, paddingBottom: 3, borderBottom: '0.5px dashed var(--border)' }}>{s.category}</div>
              {s.items.map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '3px 0' }}>
                  <span>{it.name}</span><span className="rz-num">{money(it.priceMinor)}</span>
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid var(--border2)', paddingTop: 12, marginTop: 2 }}>
            <span style={{ fontWeight: 600 }}>Total <span className="xs muted">(incl. GST)</span></span>
            <span className="rz-num" style={{ fontWeight: 700, fontSize: 19 }}>{money(totalMinor)}</span>
          </div>

          <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
            <input placeholder="Coupon code" aria-label="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())}
              style={{ flex: 1, height: 40, border: '0.5px solid var(--border2)', borderRadius: 10, padding: '0 12px', letterSpacing: '.5px' }} />
            <button className="rz-ghost" style={{ width: 'auto', padding: '0 18px' }} onClick={applyCoupon}>Apply</button>
          </div>

          <div className="kicker" style={{ marginBottom: 8 }}>Payment method</div>
          <div className="rz-seg" role="radiogroup" aria-label="Payment method" style={{ marginBottom: 14 }}>
            {METHODS.map((m) => (
              <button key={m.id} onClick={() => setMethod(m.id)} role="radio" aria-checked={method === m.id}
                aria-label={`Pay by ${m.label}`} className={method === m.id ? 'on' : ''}
                style={{ fontWeight: 600 }}>{method === m.id ? '✓ ' : ''}{m.label}</button>
            ))}
          </div>
          <button className="rz-cta" disabled={busy} onClick={takePayment}>
            {busy ? 'Processing…' : <>Take payment · <span className="rz-num">{money(totalMinor)}</span></>}
          </button>
        </div>
      )}
      <div className={'rz-toast' + (toast ? ' show' : '')}>{toast}</div>
    </div>
  );
}
