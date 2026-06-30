// Thin API client per BFF. The app never embeds business rules — it calls use cases
// exposed by the BFFs. Base URLs + tenant come from env (12-factor); see .env.example.

export const TENANT: string = (import.meta as any).env?.VITE_TENANT_ID || 'acme';

// Every surface now talks to ONE unified API (shared store + order-flow saga), so
// a customer order actually reaches the kitchen and waiter. Set VITE_API_URL to
// that single service; the per-surface VITE_*_API vars still override it if you
// ever split the backend again. Falls back to localhost for `npm run dev`.
const env = (import.meta as any).env || {};
const API: string = env.VITE_API_URL || 'http://localhost:8080';

// VITE_API_URL is the single source of truth: when it's set, EVERY surface uses
// it and the legacy per-surface VITE_*_API vars are ignored. This prevents a
// stale VITE_CUSTOMER_API (etc.) from silently routing a surface back to an old,
// isolated service. Only when VITE_API_URL is unset do the per-surface overrides
// (or localhost) apply — useful if you ever split the backend again.
const surface = (perSurface?: string) => (env.VITE_API_URL ? API : (perSurface || API));

export const BASES = {
  customer: surface(env.VITE_CUSTOMER_API),
  waiter: surface(env.VITE_WAITER_API),
  kitchen: surface(env.VITE_KITCHEN_API),
  billing: surface(env.VITE_BILLING_API),
  owner: surface(env.VITE_OWNER_API),
};

// Auth context set by the AuthProvider after login: a bearer token + the
// resolved tenant. Until then we fall back to the env tenant (anonymous/dev).
let _auth: { token?: string; tenant?: string } = {};
export function setAuth(a: { token?: string; tenant?: string }) { _auth = a || {}; }

type Opts = { method?: string; body?: any; headers?: Record<string, string>; tenant?: string };

export class ApiError extends Error {
  status: number; code?: string; details?: any;
  constructor(message: string, status: number, code?: string, details?: any) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

/** Build a fetch wrapper bound to one BFF base URL. */
export function createClient(base: string) {
  async function req(path: string, opts: Opts = {}) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-tenant-id': opts.tenant ?? _auth.tenant ?? TENANT,
      ...(opts.headers || {}),
    };
    if (_auth.token) headers['authorization'] = 'Bearer ' + _auth.token;
    const res = await fetch(base + path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(e.message || 'Request failed', res.status, e.code, e.details);
    }
    return res.status === 204 ? null : res.json();
  }
  return {
    get: (p: string, o?: Opts) => req(p, { ...o, method: 'GET' }),
    post: (p: string, body?: any, o?: Opts) => req(p, { ...o, method: 'POST', body }),
    patch: (p: string, body?: any, o?: Opts) => req(p, { ...o, method: 'PATCH', body }),
  };
}
