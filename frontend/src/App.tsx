import React, { Suspense, lazy } from 'react';
import { createBrowserRouter, RouterProvider, Link, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { RequireRole } from './auth/RequireRole';

const Customer = lazy(() => import('./surfaces/customer/Customer'));
const Kitchen = lazy(() => import('./surfaces/kitchen/Kitchen'));
const Waiter = lazy(() => import('./surfaces/waiter/Waiter'));
const Owner = lazy(() => import('./surfaces/owner/Owner'));

const ROLES = [
  { to: '/customer', label: 'Customer', sub: 'menu · order · pay', icon: '🍽' },
  { to: '/kitchen', label: 'Kitchen', sub: 'live ticket board', icon: '🔥' },
  { to: '/waiter', label: 'Waiter', sub: 'floor · now · serve', icon: '🧑‍🍳' },
  { to: '/owner', label: 'Owner', sub: 'insights · menu IQ', icon: '👑' },
];

function Landing() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 20px' }}>
      <div className="kicker">Fine dining · OMS</div>
      <h1 style={{ fontSize: 30, margin: '4px 0 6px', letterSpacing: '.4px' }}>Restorna</h1>
      <p className="muted" style={{ marginTop: 0 }}>Pick a surface. Each is a real app wired to its BFF.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14, marginTop: 22 }}>
        {ROLES.map((r) => (
          <Link key={r.to} to={r.to} className="rz-card" style={{ padding: '20px 18px', display: 'block', color: 'var(--ink)' }}>
            <div style={{ fontSize: 26 }} aria-hidden>{r.icon}</div>
            <div style={{ fontWeight: 600, marginTop: 10 }}>{r.label}</div>
            <div className="xs muted" style={{ marginTop: 2 }}>{r.sub}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Fallback() {
  return <div style={{ padding: 40, textAlign: 'center' }} className="muted">Loading…</div>;
}

function AuthBadge() {
  const { enabled, session, profile, signOut } = useAuth();
  if (!enabled || !session) return null;
  return (
    <span className="xs" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
      {profile?.role || 'signed in'} · <button onClick={signOut} style={{ border: 'none', background: 'none', color: 'var(--g)', cursor: 'pointer', fontSize: 11 }}>sign out</button>
    </span>
  );
}

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Fallback />}>
      <div>
        <div style={{ padding: '10px 16px', borderBottom: '0.5px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center' }}>
          <Link to="/demo" className="xs" style={{ color: 'var(--muted)' }}>← Restorna surfaces</Link>
          <AuthBadge />
        </div>
        {children}
      </div>
    </Suspense>
  );
}

const router = createBrowserRouter([
  // The public URL IS the diner experience — a guest scanning a table QR lands
  // straight on the menu, never on an internal picker.
  { path: '/', element: <Navigate to="/customer" replace /> },
  // The persona launcher is dev-only scaffolding, parked at /demo.
  { path: '/demo', element: <Landing /> },
  // Customer is open (anonymous QR table session — no login).
  { path: '/customer', element: <Surface><Customer /></Surface> },
  // Staff/owner are gated per persona (OTP). No-op until Supabase auth is configured.
  { path: '/kitchen', element: <Surface><RequireRole roles={['kitchen', 'manager', 'owner']} persona="kitchen"><Kitchen /></RequireRole></Surface> },
  { path: '/waiter', element: <Surface><RequireRole roles={['waiter', 'manager', 'owner']} persona="waiter"><Waiter /></RequireRole></Surface> },
  { path: '/owner', element: <Surface><RequireRole roles={['owner', 'manager']} persona="owner"><Owner /></RequireRole></Surface> },
]);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
