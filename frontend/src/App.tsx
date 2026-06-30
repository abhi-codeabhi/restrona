import React, { Suspense, lazy } from 'react';
import { createBrowserRouter, RouterProvider, Link } from 'react-router-dom';

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

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Fallback />}>
      <div>
        <div style={{ padding: '10px 16px', borderBottom: '0.5px solid var(--border)', background: 'var(--surface)' }}>
          <Link to="/" className="xs" style={{ color: 'var(--muted)' }}>← Restorna surfaces</Link>
        </div>
        {children}
      </div>
    </Suspense>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/customer', element: <Surface><Customer /></Surface> },
  { path: '/kitchen', element: <Surface><Kitchen /></Surface> },
  { path: '/waiter', element: <Surface><Waiter /></Surface> },
  { path: '/owner', element: <Surface><Owner /></Surface> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
