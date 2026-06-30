// Thin API client per BFF. The app never embeds business rules — it calls use cases
// exposed by the BFFs. Base URLs + tenant come from env (12-factor); see .env.example.

export const TENANT: string = (import.meta as any).env?.VITE_TENANT_ID || 'acme';

export const BASES = {
  customer: (import.meta as any).env?.VITE_CUSTOMER_API || 'http://localhost:8080',
  waiter: (import.meta as any).env?.VITE_WAITER_API || 'http://localhost:8081',
  kitchen: (import.meta as any).env?.VITE_KITCHEN_API || 'http://localhost:8082',
  billing: (import.meta as any).env?.VITE_BILLING_API || 'http://localhost:8083',
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
