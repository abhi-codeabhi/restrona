import React from 'react';
import { useAuth } from './AuthProvider';
import { OtpLogin } from './OtpLogin';

/* Gate a surface to one or more personas. If auth is not configured the gate is
   a no-op (the current deploy keeps working). When configured:
   - no session  → show the persona's OTP login
   - wrong role  → show "not authorised for this persona" */
export function RequireRole({ roles, persona, children }: { roles: string[]; persona: string; children: React.ReactNode }) {
  const { enabled, ready, session, profile, signOut } = useAuth();

  if (!enabled) return <>{children}</>;            // auth off → open (dev / pre-config)
  if (!ready) return <div style={{ padding: 40 }} className="muted">Checking your session…</div>;
  if (!session) return <OtpLogin persona={persona} />;

  const role = profile?.role;
  if (!role || !roles.includes(role)) {
    return (
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '48px 20px', textAlign: 'center' }}>
        <div className="rz-empty">
          You’re signed in as <b>{role || 'unknown'}</b>, which can’t open the {persona} app.
        </div>
        <button className="rz-ghost" style={{ marginTop: 14 }} onClick={signOut}>Sign in as someone else</button>
      </div>
    );
  }
  return <>{children}</>;
}
