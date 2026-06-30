import React, { useEffect, useMemo, useState } from 'react';
import {
  billingApi, normalizeOpenBills, normalizeBillRequests, normalizeTableOrders, sectionsOf,
  type OpenBill,
} from './api';
import { money } from '../../lib/format';

/* Billing agent surface. Psychology baked in:
   - ONE queue of tables to settle, ranked by who asked first — no hunting.
   - the settle screen reads like the printed bill (grouped by course) so the
     guest and agent see the same thing; one brass primary action to take payment.
   - closure: a clear "Paid" confirmation, then the table drops off the queue. */

const POLL_MS = 6000;
const METHODS = [
  { id: 'upi', label: 'UPI' }, { id: 'card', label: 'Card' }, { id: 'cash', label: 'Cash' },
];

type QueueItem = { table: number; billId?: string; totalMinor?: number; asked: boolean; reqIds: string[]; lines?: OpenBill['lines'] };

export default function Billing() {
  const [openBills, setOpenBills] = useState<OpenBill[]>([]);
  const [requests, setRequests] = useState<{ id: string; table: number }[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  function flash(m: string) { setToast(m); window.setTimeout(() => setToast(''), 2400); }

  async function refresh(initial = false) {
    if (initial) { setLoading(true); setError(null); }
    try {
      const [b, r] = await Promise.all([billingApi.getOpenBills(), billingApi.getRequests()]);
      setOpenBills(normalizeOpenBills(b));
      setRequests(normalizeBillRequests(r));
      setError(null);
    } catch (e: any) {
      if (initial) setError(e?.message || 'Could not load the billing queue');
    } finally {
      if (initial) setLoading(false);
    }
  }

  useEffect(() => {
    refresh(true);
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible' && sel == null) refresh(false); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(false); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(poll); document.removeEventListener('visibilitychange', onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  // Merge open bills + bill requests into one per-table queue.
  const queue: QueueItem[] = useMemo(() => {
    const byTable = new Map<number, QueueItem>();
    for (const b of openBills) byTable.set(b.table, { table: b.table, billId: b.id, totalMinor: b.totalMinor, lines: b.lines, asked: false, reqIds: [] });
    for (const r of requests) {
      const q = byTable.get(r.table) || { table: r.table, asked: false, reqIds: [] };
      q.asked = true; q.reqIds.push(r.id);
      byTable.set(r.table, q);
    }
    return [...byTable.values()].sort((a, b) => a.table - b.table);
  }, [openBills, requests]);

  if (sel != null) {
    const item = queue.find((q) => q.table === sel) || { table: sel, asked: false, reqIds: [] };
    return <Settle item={item} onDone={() => { setSel(null); refresh(false); }} flash={flash} toast={toast} />;
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 60px' }}>
      <div style={{ padding: '18px 0 12px' }}>
        <div className="kicker">Billing</div>
        <div style={{ fontSize: 21, fontWeight: 600 }}>Tables to settle</div>
      </div>

      {loading && <div className="rz-empty">Loading the billing queue…</div>}
      {!loading && error && <div className="rz-empty" style={{ color: 'var(--red)' }}>{error}<br />
        <button className="rz-ghost" style={{ marginTop: 12, width: 'auto', padding: '0 16px' }} onClick={() => refresh(true)}>Retry</button></div>}
      {!loading && !error && queue.length === 0 && <div className="rz-empty">No tables waiting to pay. 🎉</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {queue.map((q) => (
          <button key={q.table} onClick={() => setSel(q.table)} className="rz-card"
            style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer', border: q.asked && !q.billId ? '1px solid var(--amber)' : undefined }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--gs)', color: 'var(--gtx)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{q.table}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>Table {q.table}</div>
              <div className="xs muted">{q.billId ? 'Bill ready to collect' : q.asked ? 'Asked for the bill' : 'Open tab'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {q.billId ? <div style={{ fontWeight: 600 }}>{money(q.totalMinor || 0)}</div> : <span className="rz-pill" style={{ background: 'var(--amber)', color: '#fff' }}>Generate</span>}
            </div>
          </button>
        ))}
      </div>
      <div className={'rz-toast' + (toast ? ' show' : '')}>{toast}</div>
    </div>
  );
}

function Settle({ item, onDone, flash, toast }: any) {
  const [billId, setBillId] = useState<string | undefined>(item.billId);
  const [lines, setLines] = useState<OpenBill['lines']>(item.lines || []);
  const [totalMinor, setTotalMinor] = useState<number>(item.totalMinor || 0);
  const [orders, setOrders] = useState<any[]>([]);
  const [coupon, setCoupon] = useState('');
  const [method, setMethod] = useState('upi');
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const [loading, setLoading] = useState(!item.billId);

  // If no bill yet, preview the running (unbilled) orders for this table.
  useEffect(() => {
    if (billId) { setLoading(false); return; }
    (async () => {
      try { setOrders(normalizeTableOrders(await billingApi.getTableOrders(item.table))); }
      catch (e: any) { flash(e?.message || 'Could not load orders'); }
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
      const r = await billingApi.openTableBill(item.table);
      setBillId(r.bill.id);
      setLines((r.bill.lines || []).map((l: any) => ({ name: l.name, category: l.category ?? 'Other', priceMinor: l.price?.minor ?? 0 })));
      setTotalMinor(r.totals?.total?.minor ?? 0);
      flash('Bill generated');
    } catch (e: any) { flash(e?.message || 'Could not generate the bill'); }
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
      if (r?.paid) {
        // Clear any 'asked for bill' requests for this table.
        for (const id of item.reqIds || []) { try { await billingApi.ackRequest(id); } catch { /* non-fatal */ } }
        setPaid(true);
      } else flash('Payment recorded (partial)');
    } catch (e: any) { flash(e?.message || 'Could not take payment'); }
    finally { setBusy(false); }
  }

  if (paid) {
    return (
      <div style={{ maxWidth: 460, margin: '0 auto', padding: '40px 18px', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#E6EFE8', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 14px' }}>✓</div>
        <h2 style={{ fontSize: 19, margin: 0 }}>Paid · Table {item.table}</h2>
        <div className="sm muted" style={{ marginTop: 7 }}>{money(totalMinor)} settled by {METHODS.find((m) => m.id === method)?.label}. The table is now free.</div>
        <button className="rz-cta" style={{ marginTop: 22 }} onClick={onDone}>Back to queue</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 60px' }}>
      <div style={{ padding: '16px 0 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="rz-ghost" style={{ width: 'auto', padding: '0 14px' }} onClick={onDone}>← Queue</button>
        <div><div className="kicker">Settle</div><div style={{ fontSize: 20, fontWeight: 600 }}>Table {item.table}</div></div>
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
