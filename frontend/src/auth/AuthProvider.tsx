import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, authEnabled } from './supabase';
import { setAuth } from '../lib/api';

type Profile = { role: string; tenant_id: string; restaurant_id?: string | null; owner_name?: string };
type AuthCtx = {
  enabled: boolean;
  ready: boolean;
  session: any | null;
  profile: Profile | null;
  sendOtp: (channel: 'email' | 'phone', value: string) => Promise<void>;
  verifyOtp: (channel: 'email' | 'phone', value: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!authEnabled);
  const [session, setSession] = useState<any | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = useCallback(async (sess: any | null) => {
    if (!supabase || !sess) { setProfile(null); setAuth({}); return; }
    try {
      const { data } = await supabase.rpc('me');
      const p: Profile | null = Array.isArray(data) ? data[0] ?? null : data ?? null;
      setProfile(p);
      setAuth({ token: sess.access_token, tenant: p?.tenant_id });
    } catch {
      setProfile(null);
      setAuth({ token: sess.access_token });
    }
  }, []);

  useEffect(() => {
    if (!authEnabled || !supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, sess) => {
      setSession(sess);
      await loadProfile(sess);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const sendOtp = useCallback(async (channel: 'email' | 'phone', value: string) => {
    if (!supabase) throw new Error('Auth is not configured');
    const payload = channel === 'email' ? { email: value } : { phone: value };
    const { error } = await supabase.auth.signInWithOtp({ ...payload, options: { shouldCreateUser: true } } as any);
    if (error) throw error;
  }, []);

  const verifyOtp = useCallback(async (channel: 'email' | 'phone', value: string, token: string) => {
    if (!supabase) throw new Error('Auth is not configured');
    const payload = channel === 'email' ? { email: value, type: 'email' } : { phone: value, type: 'sms' };
    const { error } = await supabase.auth.verifyOtp({ ...payload, token } as any);
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    setSession(null); setProfile(null); setAuth({});
  }, []);

  return (
    <Ctx.Provider value={{ enabled: authEnabled, ready, session, profile, sendOtp, verifyOtp, signOut }}>
      {children}
    </Ctx.Provider>
  );
}
