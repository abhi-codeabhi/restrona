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

const STATUS_UI: Record<string, { label: string; color: string }> = {
  open: { label: 'Open tab', color: 'var(--muted)' },
  asked: { label: 'Asked for the bill', color: 'var(--amber)' },
  bill_ready: { label: 'Bill generated', color: 'var(--g)' },
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

      {loading && <div className="rz-empty">Loading the billing board…</div>}
      {!loading && error && <div className="rz-empty" style={{ color: 'var(--red)' }}>{error}<br />
        <button className="rz-ghost" style={{ marginTop: 12, width: 'auto', padding: '0 16px' }} onClick={() => refresh(true)}>Retry</button></div>}
      {!loading && !error && queue.length === 0 && <div className="rz-empty">No open tables right now.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
        {queue.map((t) => {
          const ui = STATUS_UI[t.status];
          const amount = t.status === 'bill_ready' ? t.billTotalMinor : t.runningMinor;
          return (
            <button key={t.table} onClick={() => setSel(t.table)} className="rz-card"
              style={{ padding: '13px 14px', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, borderLeft: `4px solid ${ui.color}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: 17 }}>Table {t.table}</span>
                <span style={{ fontWeight: 600 }}>{money(amount)}</span>
              </div>
              <span className="xs" style={{ color: ui.color, fontWeight: 600 }}>{ui.label}</span>
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
      <div style={{ maxWidth: 460, margin: '0 auto', padding: '40px 18px', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#E6EFE8', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 14px' }}>✓</div>
        <h2 style={{ fontSize: 19, margin: 0 }}>Paid · Table {tab.table}</h2>
        <div className="sm muted" style={{ marginTop: 7 }}>{money(totalMinor)} settled by {METHODS.find((m) => m.id === method)?.label}. The table is now free.</div>
        <button className="rz-cta" style={{ marginTop: 22 }} onClick={onDone}>Back to board</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 60px' }}>
      <div style={{ padding: '16px 0 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="rz-ghost" style={{ width: 'auto', padding: '0 14px' }} onClick={onDone}>← Board</button>
        <div><div className="kicker">Settle</div><div style={{ fontSize: 20, fontWeight: 600 }}>Table {tab.table}</div></div>
      </div>

      {loading && <div className="rz-empty">Loading…</div>}

      {!loading && !billId && (
        <div className="rz-card" style={{ padding: 16 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Running orders</div>
          {orders.length === 0 && <div className="xs muted">No unbilled orders for this table.</div>}
          {orders.map((o, i) => (
            <div key={o.id} style={{ padding: '6px 0', borderBottom: i < orders.length - 1 ? '0.5px solid var(--border)' : undefined }}>
              {o.lines.map((l: any, j: number) => (
                <div key={j} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{l.qty}× {l.name}</span><span>{money(l.priceMinor * l.qty)}</span>
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, marginTop: 10 }}>
            <span>Est. subtotal</span><span>{money(previewMinor)}</span>
          </div>
          <button className="rz-cta" style={{ marginTop: 14 }} disabled={busy || orders.length === 0} onClick={generate}>
            {busy ? 'Generating…' : 'Generate final bill'}
          </button>
        </div>
      )}

      {!loading && billId && (
        <div className="rz-card" style={{ padding: 16 }}>
          {sections.map((s) => (
            <div key={s.category} style={{ marginBottom: 12 }}>
              <div className="kicker" style={{ marginBottom: 4 }}>{s.category}</div>
              {s.items.map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                  <span>{it.name}</span><span>{money(it.priceMinor)}</span>
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: 16, borderTop: '0.5px solid var(--border)', paddingTop: 10 }}>
            <span>Total (incl. GST)</span><span>{money(totalMinor)}</span>
          </div>

          <div style={{ display: 'flex', gap: 8, margin: '14px 0' }}>
            <input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())}
              style={{ flex: 1, height: 38, border: '0.5px solid var(--border)', borderRadius: 10, padding: '0 12px' }} />
            <button className="rz-ghost" style={{ width: 'auto', padding: '0 16px' }} onClick={applyCoupon}>Apply</button>
          </div>

          <div className="kicker" style={{ marginBottom: 6 }}>Payment method</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {METHODS.map((m) => (
              <button key={m.id} onClick={() => setMethod(m.id)} style={{
                flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer', fontWeight: 600,
                border: `1px solid ${method === m.id ? 'var(--g)' : 'var(--border2)'}`,
                background: method === m.id ? 'var(--gs)' : 'var(--surface)', color: method === m.id ? 'var(--gtx)' : 'var(--muted)',
              }}>{m.label}</button>
            ))}
          </div>
          <button className="rz-cta" disabled={busy} onClick={takePayment}>
            {busy ? 'Processing…' : `Take payment · ${money(totalMinor)}`}
          </button>
        </div>
      )}
      <div className={'rz-toast' + (toast ? ' show' : '')}>{toast}</div>
    </div>
  );
}
