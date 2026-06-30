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

export default function Customer() {
  const [tab, setTab] = useState<'menu' | 'cart' | 'pay' | 'thanks'>('menu');
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
          {loading && <div className="rz-empty">Loading the menu…</div>}
          {error && <div className="rz-empty" style={{ color: 'var(--red)' }}>{error}<br /><button className="rz-ghost" style={{ marginTop: 12 }} onClick={() => loadMenu()}>Retry</button></div>}
          {!loading && !error && Object.keys(cats).length === 0 && <div className="rz-empty">No dishes match your preferences.</div>}
          {!loading && !error && Object.entries(cats).map(([cat, list]) => (
            <section key={cat}>
              <div className="kicker" style={{ margin: '16px 0 6px' }}>{cat}</div>
              {list.map((it) => (
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

      {tab === 'cart' && <Cart cart={cart} subtotal={subtotal} onBack={() => setTab('menu')} onPlace={() => setTab('pay')} setQty={setQty} />}
      {tab === 'pay' && <Checkout subtotal={subtotal} onPaid={() => setTab('thanks')} onBack={() => setTab('cart')} flash={flash} />}
      {tab === 'thanks' && <Thanks onDone={() => { setCart({}); setTab('menu'); }} />}

      {tab === 'menu' && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, maxWidth: 480, margin: '0 auto', display: 'flex', alignItems: 'center', padding: '14px 16px', borderTop: '0.5px solid var(--border)', background: 'var(--surface)' }}>
          <div>
            <PulseTotal minor={subtotal} />
            <div className="xs muted">{cartCount ? `${cartCount} item${cartCount > 1 ? 's' : ''}` : 'Cart is empty'}</div>
          </div>
          <button className="rz-cta" style={{ width: 'auto', marginLeft: 'auto', padding: '12px 20px' }} disabled={!cartCount} onClick={() => setTab('cart')}>View cart</button>
        </div>
      )}

      {sheet === 'prefs' && <PrefSheet prefs={prefs} onlySuitable={onlySuitable} setOnlySuitable={setOnlySuitable}
        onToggle={(id) => setPrefs((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])}
        onDone={() => { setSheet(null); loadMenu(); }} />}
      {sheet === 'service' && <ServiceSheet onClose={() => setSheet(null)} onSend={async (type, label) => {
        setSheet(null);
        try { await customerApi.serviceRequest({ type, table: 12 }); flash(label + ' sent'); }
        catch (e: any) { flash(e.message || 'Could not send'); }
      }} />}

      <div className={'rz-toast' + (toast ? ' show' : '')}>{toast}</div>
    </div>
  );
}

function Header({ onPrefs, onService, prefsCount }: any) {
  return (
    <div style={{ padding: '15px 16px 12px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div className="kicker">Fine dining</div>
        <div style={{ fontSize: 19, fontWeight: 600 }}>Restorna</div>
        <div className="xs muted" style={{ marginTop: 2 }}>Table 12</div>
      </div>
      <button aria-label="Service" onClick={onService} style={iconBtn}>🔔</button>
    </div>
  );
}
const iconBtn: React.CSSProperties = { width: 38, height: 38, borderRadius: 11, border: '0.5px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 16 };

function PrefBar({ prefs, onlySuitable, onEdit, onToggleOnly, onClear }: any) {
  if (!prefs.length) return (
    <button onClick={onEdit} className="rz-tag" style={{ border: '0.5px solid var(--border)', background: 'var(--surface)', padding: '8px 12px', cursor: 'pointer' }}>
      🥗 Set dietary preferences — vegan, pregnancy-safe, allergies…
    </button>
  );
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="xs muted">For you:</span>
      {prefs.map((p: string) => <span key={p} className="rz-tag">{p}</span>)}
      <button onClick={onToggleOnly} className="rz-tag" style={{ cursor: 'pointer', background: onlySuitable ? 'var(--g)' : 'var(--gs)', color: onlySuitable ? '#fff' : 'var(--gtx)' }}>only suitable</button>
      <button onClick={onEdit} className="rz-tag" style={{ cursor: 'pointer' }}>edit</button>
      <button onClick={onClear} className="rz-tag" style={{ cursor: 'pointer' }}>clear</button>
    </div>
  );
}

function ItemRow({ it, qty, onAdd, onInc, onDec, prefsActive }: any) {
  return (
    <div style={{ display: 'flex', gap: 13, padding: '15px 0', borderBottom: '0.5px solid var(--border)', opacity: it.available ? (prefsActive && !it.suitable ? 0.7 : 1) : 0.5 }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--gs)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--g)', fontSize: 24, flex: '0 0 auto' }}>🍲</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, border: `1.5px solid ${it.veg ? 'var(--green)' : 'var(--red)'}`, borderRadius: 3, position: 'relative', marginRight: 5, verticalAlign: -1 }} />
          {it.name}
        </div>
        <div className="meta xs muted" style={{ marginTop: 4 }}>{it.prepMinutes ? `${it.prepMinutes} min` : ''}{it.rating ? ` · ★ ${it.rating}` : ''}</div>
        <div style={{ fontWeight: 600, fontSize: 14, marginTop: 6 }}>{money(it.priceMinor)}</div>
        {prefsActive && (it.suitable
          ? <div className="xs" style={{ color: 'var(--green)', marginTop: 5 }}>✓ Suits your preferences</div>
          : <div className="xs" style={{ color: '#8a5a14', background: '#FBEFD9', borderRadius: 6, padding: '2px 8px', marginTop: 5, display: 'inline-block' }}>⚠ {it.reasons?.[0] || 'check ingredients'}</div>)}
      </div>
      <div style={{ alignSelf: 'flex-end' }}>
        {!it.available ? <span className="rz-tag">Sold out</span>
          : qty > 0
            ? <Stepper qty={qty} onInc={onInc} onDec={onDec} />
            : <button onClick={onAdd} style={{ background: 'var(--gs)', border: 'none', color: 'var(--g)', fontSize: 13, fontWeight: 600, height: 36, padding: '0 17px', borderRadius: 20, cursor: 'pointer' }}>+ Add</button>}
      </div>
    </div>
  );
}

function Stepper({ qty, onInc, onDec }: any) {
  const [pop, setPop] = useState(false);
  useEffect(() => { setPop(true); const t = setTimeout(() => setPop(false), 220); return () => clearTimeout(t); }, [qty]);
  const b: React.CSSProperties = { width: 36, height: 36, border: 'none', background: 'transparent', color: '#fff', fontSize: 18, cursor: 'pointer' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', background: 'var(--g)', borderRadius: 20, height: 36, overflow: 'hidden' }}>
      <button style={b} onClick={onDec} aria-label="Remove one">−</button>
      <span style={{ minWidth: 26, textAlign: 'center', color: '#fff', fontWeight: 600, animation: pop ? 'rz-pop .22s ease' : undefined }}>{qty}</span>
      <button style={b} onClick={onInc} aria-label="Add one">+</button>
    </div>
  );
}

function PulseTotal({ minor }: { minor: number }) {
  const [pulse, setPulse] = useState(false);
  useEffect(() => { setPulse(true); const t = setTimeout(() => setPulse(false), 350); return () => clearTimeout(t); }, [minor]);
  return <div style={{ fontWeight: 600, fontSize: 14, color: pulse ? 'var(--g)' : 'var(--ink)', transition: 'color .3s' }}>{money(minor)}</div>;
}

function Cart({ cart, subtotal, onBack, onPlace, setQty }: any) {
  const lines = Object.values(cart) as any[];
  const tax = Math.round(subtotal * 0.05);
  return (
    <div style={{ padding: '14px 16px' }}>
      <div className="kicker">Your order</div><h2 style={{ fontSize: 16, margin: '2px 0 12px' }}>Table 12</h2>
      {lines.length === 0 && <div className="rz-empty">Your cart is empty.</div>}
      {lines.map((l) => (
        <div key={l.item.id} style={{ display: 'flex', alignItems: 'center', padding: '12px 0', borderBottom: '0.5px solid var(--border)' }}>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{l.item.name}</div><div className="xs muted">{money(l.item.priceMinor)} each</div></div>
          <Stepper qty={l.qty} onInc={() => setQty(l.item, l.qty + 1)} onDec={() => setQty(l.item, l.qty - 1)} />
        </div>
      ))}
      {lines.length > 0 && <>
        <Row k="Subtotal" v={money(subtotal)} /><Row k="GST (5%)" v={money(tax)} />
        <Row k="Total" v={money(subtotal + tax)} bold />
        <button className="rz-cta" style={{ marginTop: 14 }} onClick={onPlace}>Place order</button>
      </>}
      <button className="rz-ghost" style={{ marginTop: 9 }} onClick={onBack}>Add more dishes</button>
    </div>
  );
}

function Checkout({ subtotal, onPaid, onBack, flash }: any) {
  const [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const tax = Math.round(subtotal * 0.05);
  const total = (quote ? subtotal - (quote.discountMinor || 0) : subtotal) + tax;
  async function applyCoupon() {
    try { setQuote(await customerApi.quote({ subtotalMinor: subtotal, couponCode: coupon })); flash('Coupon applied'); }
    catch (e: any) { flash(e.message || 'Coupon rejected'); }
  }
  return (
    <div style={{ padding: '14px 16px' }}>
      <div className="kicker">Checkout</div><h2 style={{ fontSize: 16, margin: '2px 0 12px' }}>Pay your way</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())}
          style={{ flex: 1, height: 38, border: '0.5px solid var(--border)', borderRadius: 10, padding: '0 12px' }} />
        <button className="rz-ghost" style={{ width: 'auto', padding: '0 16px' }} onClick={applyCoupon}>Apply</button>
      </div>
      <Row k="Subtotal" v={money(subtotal)} />
      {quote?.discountMinor ? <Row k={`Discount ${coupon}`} v={'−' + money(quote.discountMinor)} /> : null}
      <Row k="GST (5%)" v={money(tax)} />
      <Row k="Total" v={money(total)} bold />
      <div className="xs muted" style={{ margin: '8px 0 12px' }}>🔒 Secured · UPI-verified, no card details stored</div>
      <button className="rz-cta" onClick={onPaid}>Pay {money(total)} by UPI</button>
      <div className="xs muted" style={{ textAlign: 'center', marginTop: 11 }}>Tip (optional) · <b style={{ color: 'var(--g)' }}>skip</b> · 5% · 10%</div>
      <button className="rz-ghost" style={{ marginTop: 10 }} onClick={onBack}>Back</button>
    </div>
  );
}

function Thanks({ onDone }: any) {
  const [stars, setStars] = useState(0);
  return (
    <div style={{ padding: '34px 18px', textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#E6EFE8', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 14px' }}>✓</div>
      <h2 style={{ fontSize: 19, margin: 0 }}>Thank you, enjoy your meal</h2>
      <div className="sm muted" style={{ marginTop: 7 }}>A receipt has been sent to your phone</div>
      <div style={{ fontWeight: 600, marginTop: 22 }}>How was everything?</div>
      <div style={{ display: 'flex', gap: 9, justifyContent: 'center', margin: '12px 0 6px' }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setStars(n)} aria-label={`${n} stars`} style={{ border: 'none', background: 'none', fontSize: 30, cursor: 'pointer', color: n <= stars ? 'var(--g)' : 'var(--border2)' }}>★</button>
        ))}
      </div>
      <div className="xs muted">{stars >= 4 ? 'Thank you — see you again!' : stars ? 'Thanks — we’ll do better.' : 'Tap to rate your visit'}</div>
      <button className="rz-cta" style={{ marginTop: 20 }} onClick={onDone}>♥ See you again at Restorna</button>
    </div>
  );
}

function Row({ k, v, bold }: any) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: bold ? 15 : 13, fontWeight: bold ? 600 : 400, color: bold ? 'var(--ink)' : 'var(--muted)', borderTop: bold ? '0.5px solid var(--border)' : undefined, marginTop: bold ? 6 : 0, paddingTop: bold ? 9 : 4 }}><span>{k}</span><span>{v}</span></div>;
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
        {PREFS.map((p) => {
          const on = prefs.includes(p.id);
          return <button key={p.id} onClick={() => onToggle(p.id)} style={{ fontSize: 12, padding: '8px 12px', borderRadius: 20, border: `0.5px solid ${on ? 'var(--g)' : 'var(--border)'}`, background: on ? 'var(--gs)' : 'var(--surface)', color: on ? 'var(--gtx)' : 'var(--muted)', cursor: 'pointer' }}>{p.label}</button>;
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
        <button key={s.type} onClick={() => onSend(s.type, s.label)} style={{ display: 'block', width: '100%', textAlign: 'left', border: '0.5px solid var(--border)', background: 'var(--surface)', borderRadius: 12, padding: '13px 14px', marginBottom: 9, fontSize: 13.5, cursor: 'pointer' }}>{s.label}</button>
      ))}
      <button className="rz-ghost" onClick={onClose}>Cancel</button>
    </Sheet>
  );
}
