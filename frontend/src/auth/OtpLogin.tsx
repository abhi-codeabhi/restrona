import React, { useState } from 'react';
import { useAuth } from './AuthProvider';

/* Per-persona OTP login. The `persona` prop only changes the heading/copy — the
   mechanism is identical for every role (enter contact → get a code → verify).
   Psychology: one field at a time, clear progress, friendly errors. */
export function OtpLogin({ persona = 'staff' }: { persona?: string }) {
  const { sendOtp, verifyOtp } = useAuth();
  const [channel, setChannel] = useState<'email' | 'phone'>('email');
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'enter' | 'verify'>('enter');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setBusy(true); setErr(null);
    try { await sendOtp(channel, value.trim()); setStep('verify'); }
    catch (e: any) { setErr(e?.message || 'Could not send the code'); }
    finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setErr(null);
    try { await verifyOtp(channel, value.trim(), code.trim()); /* AuthProvider updates session */ }
    catch (e: any) { setErr(e?.message || 'Invalid or expired code'); }
    finally { setBusy(false); }
  }

  const input: React.CSSProperties = { width: '100%', height: 44, border: '0.5px solid var(--border)', borderRadius: 12, padding: '0 14px', fontSize: 15 };

  return (
    <div style={{ maxWidth: 380, margin: '0 auto', padding: '48px 20px' }}>
      <div className="kicker">Sign in</div>
      <h1 style={{ fontSize: 24, margin: '4px 0 4px' }}>{persona} login</h1>
      <p className="muted sm" style={{ marginTop: 0 }}>We’ll send a one-time code to verify it’s you.</p>

      {step === 'enter' && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <Seg on={channel === 'email'} onClick={() => setChannel('email')}>Email</Seg>
            <Seg on={channel === 'phone'} onClick={() => setChannel('phone')}>Phone</Seg>
          </div>
          <input style={input} inputMode={channel === 'phone' ? 'tel' : 'email'}
            placeholder={channel === 'email' ? 'you@restaurant.com' : '+91 98xxxxxxxx'}
            value={value} onChange={(e) => setValue(e.target.value)} />
          {err && <div className="xs" style={{ color: 'var(--red)', marginTop: 8 }}>{err}</div>}
          <button className="rz-cta" style={{ marginTop: 16 }} disabled={busy || !value.trim()} onClick={send}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </div>
      )}

      {step === 'verify' && (
        <div style={{ marginTop: 22 }}>
          <div className="sm muted" style={{ marginBottom: 10 }}>Enter the 6-digit code sent to <b style={{ color: 'var(--ink)' }}>{value}</b>.</div>
          <input style={{ ...input, letterSpacing: 6, textAlign: 'center', fontSize: 20 }} inputMode="numeric"
            placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          {err && <div className="xs" style={{ color: 'var(--red)', marginTop: 8 }}>{err}</div>}
          <button className="rz-cta" style={{ marginTop: 16 }} disabled={busy || code.length < 4} onClick={verify}>
            {busy ? 'Verifying…' : 'Verify & continue'}
          </button>
          <button className="rz-ghost" style={{ marginTop: 9 }} onClick={() => { setStep('enter'); setCode(''); setErr(null); }}>Use a different contact</button>
        </div>
      )}
    </div>
  );
}

function Seg({ on, onClick, children }: any) {
  return (
    <button onClick={onClick} style={{ flex: 1, padding: 10, borderRadius: 10, border: 'none',
      background: on ? 'var(--g)' : 'var(--s1)', color: on ? '#fff' : 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>{children}</button>
  );
}
