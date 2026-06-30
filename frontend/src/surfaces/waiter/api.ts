import { createClient, BASES } from '../../lib/api';

const c = createClient(BASES.waiter);

// Thin client over the Waiter BFF (bff/waiter/src/server.js). The app holds no
// business rules — it calls the composed floor + service-request use cases.
export const waiterApi = {
  // GET /floor -> { id, tables:[{ n, status, order, waiterId }] }
  getFloor: () => c.get('/floor'),
  // GET /requests -> open service requests (state !== 'done')
  getRequests: () => c.get('/requests'),
  // POST /requests/escalate { now } -> flips overdue 'assigned' rows to 'escalated'.
  // Called on poll so the feed re-ranks itself as requests age (server-driven aging).
  escalateDue: (now: number = Date.now()) => c.post('/requests/escalate', { now }),
  // POST /requests/:id/ack { now } -> acknowledged request (state 'done')
  ackRequest: (requestId: string, now: number = Date.now()) =>
    c.post(`/requests/${encodeURIComponent(requestId)}/ack`, { now }),
  // POST /tables/move { srcN, dstN } -> { floor, verb:'moved'|'swapped' }
  moveTable: (srcN: number, dstN: number) => c.post('/tables/move', { srcN, dstN }),
  // POST /tables/assign { n, waiterId } -> floor
  assignWaiter: (n: number, waiterId: string) => c.post('/tables/assign', { n, waiterId }),
  // GET /serve-queue -> ready, not-yet-delivered tickets (ONE per order).
  getServeQueue: () => c.get('/serve-queue'),
  // POST /tickets/:id/serve -> marks just that ticket served (per order, not table).
  serveTicket: (ticketId: string) => c.post('/tickets/' + encodeURIComponent(ticketId) + '/serve'),
};

// ---- Normalizers: BFF responses wrap differently (use-case ok() values surface
// directly as the JSON body), so coerce to stable shapes the UI renders. ----

export type Req = {
  id: string;
  type: string;
  table: number;
  state: string; // 'assigned' | 'escalated'
  assignedTo: string | null;
  createdAt: number;
};

export function normalizeRequests(res: any): Req[] {
  const raw = Array.isArray(res) ? res : res?.requests ?? res?.value ?? res?.items ?? [];
  return (raw || [])
    .map((r: any) => ({
      id: r.id,
      type: r.type ?? 'call',
      table: r.table,
      state: r.state ?? 'assigned',
      assignedTo: r.assignedTo ?? null,
      createdAt: Number(r.createdAt) || Date.now(),
    }))
    .filter((r: Req) => r.id && r.state !== 'done');
}

export type Table = {
  n: number;
  status: string; // free | seated | cooking | ready | billing
  order: string | null;
  waiterId: string | null;
};

export function normalizeFloor(res: any): Table[] {
  const doc = res?.floor ?? res?.value ?? res; // moveTable returns { floor, verb }
  const raw = doc?.tables ?? (Array.isArray(doc) ? doc : []);
  return (raw || [])
    .map((t: any) => ({
      n: t.n,
      status: t.status ?? 'free',
      order: t.order ?? null,
      waiterId: t.waiterId ?? null,
    }))
    .filter((t: Table) => t.n != null);
}

export function moveVerb(res: any): 'moved' | 'swapped' {
  return res?.verb === 'swapped' ? 'swapped' : 'moved';
}

// A ready ticket awaiting delivery — ONE per order, so two rounds at the same
// table are two separate serve cards and serving one leaves the other.
export type ServeTicket = {
  ticketId: string;
  table: number;
  orderId?: string;
  dishes: string[];
  readyAt: number;
};

export function normalizeServeQueue(res: any): ServeTicket[] {
  const raw = Array.isArray(res) ? res : res?.value ?? res?.tickets ?? [];
  return (raw || [])
    .map((t: any) => ({
      ticketId: (t.ticketId ?? t.id)?.toString(),
      table: Number(String(t.table ?? '').replace(/\D/g, '')) || 0,
      orderId: t.orderId,
      dishes: (t.items ?? []).map((i: any) => i.name ?? i).filter(Boolean),
      readyAt: t.readyAt ? Date.parse(t.readyAt) || Date.now() : Date.now(),
    }))
    .filter((t: ServeTicket) => t.ticketId);
}
