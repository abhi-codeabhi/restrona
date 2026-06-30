import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const anon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

// Auth is OPTIONAL: if Supabase isn't configured, the app runs without login
// (so the current Render deploy keeps working). Set the two env vars to turn it on.
export const authEnabled = Boolean(url && anon);

// When Supabase isn't configured we fall back to a DEV login (hardcoded OTP 1234)
// so staff can still sign into their persona and role-gating works for demos.
export const devAuth = !authEnabled;

export const supabase: SupabaseClient | null = authEnabled
  ? createClient(url!, anon!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
