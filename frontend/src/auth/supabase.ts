import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const anon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

// Auth is OPTIONAL: if Supabase isn't configured, the app runs without login
// (so the current Render deploy keeps working). Set the two env vars to turn it on.
export const authEnabled = Boolean(url && anon);

export const supabase: SupabaseClient | null = authEnabled
  ? createClient(url!, anon!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
