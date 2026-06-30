import React, { useEffect, useMemo, useState } from 'react';
import { customerApi, normalizeMenu } from './api';
import { money } from '../../lib/format';

/* Customer PWA — diner surface. Psychology baked in:
   - dietary guardrails (set prefs once → menu flags conflicts + reasons)
   - Add expands into a stepper with a pop (Jakob's law + immediate feedback)
   - live cart total pulse (drop-to-cart confirmation)
   - 3-step checkout, no hidden fees, skippable tip (no dark patterns)
   - peak-end thank-you + rating
   - service bell with a "<waiter> is on the way" closure on acknowledgement */

const PREFS = [
  { id: 'vegetarian', label: 'Vegetarian' }, { id: 'vegan', label: 'Vegan' },
  { id: 'eggless', label: 'Eggless' }, { id: 'pregnancy', label: 'Pregnancy-safe' },
  { id: 'glutenfree', label: 'Gluten-free' }, { id: 'nutfree', label: 'Nut allergy' },
  { id: 'lowsugar', label: 'Low sugar' }, { id: 'mild', label: 'Mild spice' },
];
const SERVICES = [
  { type: 'call', label: 'Call waiter' }, { type: 'water', label: 'Ask for water' },
  { type: 'bill', label: 'Ask for the bill' }, { type: 'cutlery', label: 'Cutlery / napkins' },
];

// The table comes from the QR the manager printed: /customer?table=7. Falls back
// to 12 for a bare /customer (e.g. the demo launcher) so nothing breaks.
const TABLE = (() => {
  try {
    const raw = new URLSearchParams(window.location.search).get('table');
    const n = raw ? parseInt(String(raw).replace(/\D/g, ''), 10) : NaN;
    return Number.isInteger(n) && n > 0 ? n : 12;
  } catch { return 12; }
})();

export default function Customer() {
  // Dine-in: no payment at order time. Place an order (it goes to the kitchen),
  // keep ordering across the meal, and ask for the bill at the end.
  const [tab, setTab] = useState<'menu' | 'cart' | 'sent'>('menu');
  const [placing, setPlacing] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<string[]>([]);
  const [onlySuitable, setOnlySuitable] = useState(false);
  const [cart, setCart] = useState<Record<string, { qty: number; item: any }>>({});
  const [sheet, setSheet] = useState<null | 'prefs' | 'service'>(null);
  const [toast, setToast] = useState('');

  function flash(m: string) { setToast(m); setTimeout(() => setToast(''), 2200); }

  async function loadMenu(p = prefs) {
    setLoading(true); setError(null);
    try { setItems(normalizeMenu(await customerApi.getMenu(p))); }
    catch (e: any) { setError(e.message || 'Could not load the menu'); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadMenu([]); /* eslint-disable-next-line */ }, []);

  const cartCount = Object.values(cart).reduce((n, c) => n + c.qty, 0);
  const subtotal = Object.values(cart).reduce((s, c) => s + c.qty * c.item.priceMinor, 0);

  function setQty(item: any, qty: number) {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[item.id]; else next[item.id] = { qty, item };
      return next;
    });
  }

  // Send the cart to the kitchen as an order. No payment — the bill is settled at
  // the end of the meal by the waiter/billing agent. Clears the cart on success
  // so the guest can immediately start another round.
  async function placeOrder() {
    const lines = Object.values(cart).map((c) => ({
      menuItemId: c.item.id, unitPriceMinor: c.item.priceMinor, qty: c.qty,
    }));
    if (lines.length === 0) return;
    setPlacing(true);
    try {
      await customerApi.placeOrder({ tableId: 'T' + TABLE, items: lines });
      setCart({});
      setTab('sent');
    } catch (e: any) {
      flash(e?.message || 'Could not send your order — please try again');
    } finally {
      setPlacing(false);
    }
  }

  const cats = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const it of items) {
      if (onlySuitable && prefs.length && !it.suitable) continue;
      (groups[it.categoryId] ??= []).push(it);
    }
    return groups;
  }, [items, onlySuitable, prefs]);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 90 }}>
      <Header onPrefs={() => setSheet('prefs')} onService={() => setSheet('service')} prefsCount={prefs.length} />

      {tab === 'menu' && (
        <div style={{ padding: '8px 16px' }}>
          <PrefBar prefs={prefs} onlySuitable={onlySuitable} onEdit={() => setSheet('prefs')}
            onToggleOnly={() => setOnlySuitable((v) => !v)} onClear={() => { setPrefs([]); setOnlySuitable(false); loadMenu([]); }} />
          {loading && <MenuSkeleton />}
          {error && <div className="rz-empty" style={{ color: 'var(--red)' }}>{error}<br /><button className="rz-ghost" style={{ marginTop: 12 }} onClick={() => loadMenu()}>Retry</button></div>}
          {!loading && !error && Object.keys(cats).length === 0 && <div className="rz-empty">No dishes match your preferences.</div>}
          {!loading && !error && Object.entries(cats).map(([cat, list]) => (
            <section key={cat}>
              <div className="kicker" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '22px 0 8px', paddingBottom: 7, borderBottom: '0.5px solid var(--border)' }}>
                <span>{cat}</span>
                <span style={{ letterSpacing: '.5px', opacity: .7 }} className="rz-num">{(list as any[]).length}</span>
              </div>
              {(list as any[]).map((it) => (
                <ItemRow key={it.id} it={it} prefsActive={prefs.length > 0}
                  qty={cart[it.id]?.qty || 0}
                  onAdd={() => { setQty(it, 1); flash('Added'); }}
                  onInc={() => setQty(it, (cart[it.id]?.qty || 0) + 1)}
                  onDec={() => setQty(it, (cart[it.id]?.qty || 0) - 1)} />
              ))}
            </section>
          ))}
        </div>
      )}

      {tab === 'cart' && <Cart cart={cart} subtotal={subtotal} placing={placing} onBack={() => setTab('menu')} onPlace={placeOrder} setQty={setQty} />}
      {tab === 'sent' && <Sent onMore={() => setTab('menu')} onBill={async () => {
        try { await customerApi.serviceRequest({ type: 'bill', table: TABLE }); flash('Bill requested — a server is on the way'); }
        catch (e: any) { flash(e?.message || 'Could not request the bill'); }
      }} />}

      {tab === 'menu' && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, maxWidth: 480, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', borderTop: '0.5px solid var(--border)', background: 'var(--surface)', boxShadow: cartCount ? '0 -6px 20px rgba(33,30,24,.05)' : 'none' }}>
          <div style={{ minWidth: 0 }}>
            <div className="xs muted" style={{ letterSpacing: '.3px' }}>{cartCount ? `${cartCount} item${cartCount > 1 ? 's' : ''} · running total` : 'Running total'}</div>
            <PulseTotal minor={subtotal} />
          </div>
          <button className="rz-cta" style={{ width: 'auto', marginLeft: 'auto', padding: '0 22px', minHeight: 50, fontSize: 14, opacity: cartCount ? 1 : .5 }} disabled={!cartCount} onClick={() => setTab('cart')}>{cartCount ? 'Review order →' : 'Cart is empty'}</button>
        </div>
      )}

      {sheet === 'prefs' && <PrefSheet prefs={prefs} onlySuitable={onlySuitable} setOnlySuitable={setOnlySuitable}
        onToggle={(id) => setPrefs((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])}
        onDone={() => { setSheet(null); loadMenu(); }} />}
      {sheet === 'service' && <ServiceSheet onClose={() => setSheet(null)} onSend={async (type, label) => {
        setSheet(null);
        try { await customerApi.serviceRequest({ type, table: TABLE }); flash(label + ' sent'); }
        catch (e: any) { flash(e.message || 'Could not send'); }
      }} />}

      <div className={'rz-toast' + (toast ? ' show' : '')}>{toast}</div>
    </div>
  );
}

function Header({ onPrefs, onService, prefsCount }: any) {
  return (
    <div style={{ padding: '16px 16px 13px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 10 }}>
      <div>
        <div className="kicker">Fine dining</div>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '.2px', marginTop: 1 }}>Restorna</div>
        <div className="xs muted" style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
          Table {TABLE} · dine-in
        </div>
      </div>
      <button aria-label="Call for service" className="rz-tap rz-card" onClick={onService} style={iconBtn}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>🔔</span>
        <span className="kicker" style={{ fontSize: 8.5, marginTop: 2 }}>Service</span>
      </button>
    </div>
  );
}
const iconBtn: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 52, minHeight: 48, padding: '6px 10px', cursor: 'pointer' };

function PrefBar({ prefs, onlySuitable, onEdit, onToggleOnly, onClear }: any) {
  if (!prefs.length) return (
    <button onClick={onEdit} className="rz-tap rz-card" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '11px 13px', cursor: 'pointer', marginTop: 2 }}>
      <span style={{ fontSize: 18 }}>🥗</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>Set dietary preferences</span>
        <span className="xs muted">Vegan, pregnancy-safe, allergies — we'll flag what fits</span>
      </span>
      <span className="kicker" style={{ marginLeft: 'auto', flex: '0 0 auto' }}>Set</span>
    </button>
  );
  return (
    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
      <span className="kicker" style={{ marginRight: 1 }}>For you</span>
      {prefs.map((p: string) => <span key={p} className="rz-tag">{p}</span>)}
      <button onClick={onToggleOnly} aria-pressed={onlySuitable} className={'rz-chip' + (onlySuitable ? ' on' : '')} style={{ fontSize: 11, padding: '5px 11px' }}>{onlySuitable ? '✓ suitable only' : 'suitable only'}</button>
      <button onClick={onEdit} className="rz-chip" style={{ fontSize: 11, padding: '5px 11px' }}>edit</button>
      <button onClick={onClear} className="rz-chip" style={{ fontSize: 11, padding: '5px 11px' }}>clear</button>
    </div>
  );
}

function MenuSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the menu" style={{ marginTop: 8 }}>
      <div className="rz-skel" style={{ width: 90, height: 11, margin: '22px 0 14px' }} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: 'flex', gap: 13, padding: '16px 0', borderBottom: '0.5px solid var(--border)' }}>
          <div className="rz-skel" style={{ width: 66, height: 66, borderRadius: 14, flex: '0 0 auto' }} />
          <div style={{ flex: 1, paddingTop: 4 }}>
            <div className="rz-skel" style={{ width: '70%', height: 14, marginBottom: 9 }} />
            <div className="rz-skel" style={{ width: '40%', height: 10, marginBottom: 11 }} />
            <div className="rz-skel" style={{ width: 56, height: 13 }} />
          </div>
          <div className="rz-skel" style={{ width: 76, height: 42, borderRadius: 22, alignSelf: 'flex-end' }} />
        </div>
      ))}
    </div>
  );
}

function ItemRow({ it, qty, onAdd, onInc, onDec, prefsActive }: any) {
  return (
    <div style={{ display: 'flex', gap: 13, padding: '16px 0', borderBottom: '0.5px solid var(--border)', opacity: it.available ? (prefsActive && !it.suitable ? 0.65 : 1) : 0.5 }}>
      <div style={{ width: 66, height: 66, borderRadius: 14, background: 'var(--gs)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--g)', fontSize: 25, flex: '0 0 auto' }}>🍲</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span aria-label={it.veg ? 'Vegetarian' : 'Non-vegetarian'} title={it.veg ? 'Vegetarian' : 'Non-vegetarian'} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, border: `1.5px solid ${it.veg ? 'var(--green)' : 'var(--red)'}`, borderRadius: it.veg ? 3 : '50%', flex: '0 0 auto' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: it.veg ? 'var(--green)' : 'var(--red)' }} />
          </span>
          <span style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.25 }}>{it.name}</span>
        </div>
        <div className="meta xs muted" style={{ marginTop: 5 }}>{it.prepMinutes ? `~${it.prepMinutes} min` : ''}{it.prepMinutes && it.rating ? ' · ' : ''}{it.rating ? `★ ${it.rating}` : ''}</div>
        <div className="rz-num" style={{ fontWeight: 600, fontSize: 15, marginTop: 7 }}>{money(it.priceMinor)}</div>
        {prefsActive && (it.suitable
          ? <div className="xs" style={{ color: 'var(--green)', marginTop: 6, fontWeight: 600 }}>✓ Suits your preferences</div>
          : <div className="xs" style={{ color: 'var(--gtx)', background: 'var(--gs)', borderRadius: 6, padding: '3px 9px', marginTop: 6, display: 'inline-block' }}>⚠ {it.reasons?.[0] || 'check ingredients'}</div>)}
      </div>
      <div style={{ alignSelf: 'flex-end' }}>
        {!it.available ? <span className="rz-tag">Sold out</span>
          : qty > 0
            ? <Stepper qty={qty} onInc={onInc} onDec={onDec} />
            : <button onClick={onAdd} aria-label={`Add ${it.name}`} style={{ background: 'var(--gs)', border: '1px solid var(--g)', color: 'var(--gtx)', fontSize: 14, fontWeight: 600, minHeight: 42, padding: '0 20px', borderRadius: 22, cursor: 'pointer' }}>+ Add</button>}
      </div>
    </div>
  );
}

function Stepper({ qty, onInc, onDec }: any) {
  const [pop, setPop] = useState(false);
  useEffect(() => { setPop(true); const t = setTimeout(() => setPop(false), 220); return () => clearTimeout(t); }, [qty]);
  const b: React.CSSProperties = { width: 42, height: 42, border: 'none', background: 'transparent', color: '#fff', fontSize: 19, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', background: 'var(--g)', borderRadius: 22, height: 42, overflow: 'hidden' }}>
      <button style={b} onClick={onDec} aria-label="Remove one">−</button>
      <span className="rz-num" style={{ minWidth: 24, textAlign: 'center', color: '#fff', fontWeight: 600, animation: pop ? 'rz-pop .22s ease' : undefined }}>{qty}</span>
      <button style={b} onClick={onInc} aria-label="Add one">+</button>
    </div>
  );
}

function PulseTotal({ minor }: { minor: number }) {
  const [pulse, setPulse] = useState(false);
  useEffect(() => { setPulse(true); const t = setTimeout(() => setPulse(false), 350); return () => clearTimeout(t); }, [minor]);
  return <div className="rz-num" style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.1, color: pulse ? 'var(--g)' : 'var(--ink)', transition: 'color .3s' }}>{money(minor)}</div>;
}

function Cart({ cart, subtotal, placing, onBack, onPlace, setQty }: any) {
  const lines = Object.values(cart) as any[];
  const tax = Math.round(subtotal * 0.05);
  return (
    <div style={{ padding: '16px 16px' }}>
      <div className="kicker">This round</div><h2 style={{ fontSize: 18, margin: '3px 0 14px' }}>Table {TABLE}</h2>
      {lines.length === 0 && <div className="rz-empty">Your cart is empty.</div>}
      {lines.map((l) => (
        <div key={l.item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderBottom: '0.5px solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 15 }}>{l.item.name}</div><div className="xs muted rz-num" style={{ marginTop: 2 }}>{money(l.item.priceMinor)} each</div></div>
          <Stepper qty={l.qty} onInc={() => setQty(l.item, l.qty + 1)} onDec={() => setQty(l.item, l.qty - 1)} />
        </div>
      ))}
      {lines.length > 0 && <>
        <div style={{ marginTop: 14 }}>
          <Row k="Subtotal" v={money(subtotal)} /><Row k="GST (5%)" v={money(tax)} />
          <Row k="Running total" v={money(subtotal + tax)} bold />
        </div>
        <div className="rz-card" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', margin: '12px 0 0', background: 'var(--s1)' }}>
          <span style={{ fontSize: 15 }}>🧾</span>
          <span className="xs muted">No payment now — keep ordering and settle the full bill at the end of your meal.</span>
        </div>
        <button className="rz-cta" style={{ marginTop: 14 }} disabled={placing} onClick={onPlace}>
          {placing ? 'Sending to kitchen…' : 'Send order to kitchen'}
        </button>
      </>}
      <button className="rz-ghost" style={{ marginTop: 10 }} onClick={onBack}>Add more dishes</button>
    </div>
  );
}

function Sent({ onMore, onBill }: any) {
  return (
    <div style={{ padding: '48px 22px', textAlign: 'center' }}>
      <div style={{ width: 76, height: 76, borderRadius: '50%', background: '#E6EFE8', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto 18px', animation: 'rz-pop .45s ease' }}>✓</div>
      <div className="kicker" style={{ marginBottom: 4 }}>Table {TABLE}</div>
      <h2 style={{ fontSize: 21, margin: 0, letterSpacing: '.2px' }}>Order sent to the kitchen</h2>
      <div className="sm muted" style={{ marginTop: 9, maxWidth: 300, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>Your dishes are being prepared. Order as many rounds as you like — you'll pay once, at the end.</div>
      <div style={{ marginTop: 26, textAlign: 'left' }}>
        <button className="rz-cta" onClick={onMore}>Order more dishes</button>
        <button className="rz-ghost" style={{ marginTop: 10 }} onClick={onBill}>Ask for the bill</button>
      </div>
    </div>
  );
}

function Row({ k, v, bold }: any) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: bold ? 16 : 13, fontWeight: bold ? 700 : 400, color: bold ? 'var(--ink)' : 'var(--muted)', borderTop: bold ? '0.5px solid var(--border)' : undefined, marginTop: bold ? 6 : 0, paddingTop: bold ? 9 : 4 }}><span>{k}</span><span className="rz-num">{v}</span></div>;
}

function Sheet({ title, children }: any) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(33,30,24,.35)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 40 }}>
      <div style={{ width: '100%', maxWidth: 480, background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '16px 18px 24px', animation: 'rz-in .25s ease' }}>
        <div className="kicker" style={{ marginBottom: 10 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function PrefSheet({ prefs, onToggle, onDone, onlySuitable, setOnlySuitable }: any) {
  return (
    <Sheet title="Tell us about you">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {PREFS.map((p) => {
          const on = prefs.includes(p.id);
          return <button key={p.id} aria-pressed={on} onClick={() => onToggle(p.id)} className={'rz-chip' + (on ? ' on' : '')} style={{ padding: '9px 14px' }}>{on ? '✓ ' : ''}{p.label}</button>;
        })}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 0' }}>
        <input type="checkbox" checked={onlySuitable} onChange={() => setOnlySuitable(!onlySuitable)} /> Show only dishes that suit me
      </label>
      <button className="rz-cta" style={{ marginTop: 10 }} onClick={onDone}>Done</button>
    </Sheet>
  );
}

function ServiceSheet({ onClose, onSend }: any) {
  return (
    <Sheet title="How can we help?">
      {SERVICES.map((s) => (
        <button key={s.type} onClick={() => onSend(s.type, s.label)} className="rz-tap rz-card" style={{ display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left', padding: '15px 15px', marginBottom: 9, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>{s.label}<span className="kicker" style={{ marginLeft: 'auto' }}>Send →</span></button>
      ))}
      <button className="rz-ghost" style={{ marginTop: 4 }} onClick={onClose}>Cancel</button>
    </Sheet>
  );
}
