import { createClient, BASES } from '../../lib/api';

const c = createClient(BASES.kitchen);

// Thin wrapper over the Kitchen BFF (bff/kitchen/src/server.js). The UI calls these
// use cases — it never embeds kitchen business rules.
export const kitchenApi = {
  // GET /board — the live KDS board (tickets + item states).
  getBoard: () => c.get('/board'),
  // GET /all-day — Map(itemName -> count) of not-yet-ready items, exposed as a plain object.
  getAllDay: () => c.get('/all-day'),
  // POST /tickets/:id/advance { itemIndex } — advance one item new -> preparing -> ready.
  advanceItem: (ticketId: string, itemIndex: number) =>
    c.post('/tickets/' + encodeURIComponent(ticketId) + '/advance', { itemIndex }),
  // POST /tickets/:id/bump — mark the whole ticket ready.
  bumpTicket: (ticketId: string) =>
    c.post('/tickets/' + encodeURIComponent(ticketId) + '/bump'),
  // POST /tickets/receive { orderId, table, items } — fire a ticket onto the board.
  receiveTicket: (body: any) => c.post('/tickets/receive', body),
  // POST /menu/86 { itemId, available } — toggle a menu item's availability.
  toggle86: (itemId: string, available: boolean) => c.post('/menu/86', { itemId, available }),
};

export type ItemStatus = 'new' | 'preparing' | 'ready';

export interface KdsItem {
  index: number;
  name: string;
  station: string;
  status: ItemStatus;
}
export interface KdsTicket {
  id: string;
  orderId?: string;
  table?: string;
  items: KdsItem[];
  receivedAt?: number; // epoch ms, for aging
  done: boolean; // all items ready
}

// The /board response shape may vary (array of tickets, { tickets:[...] }, { board:[...] }),
// and item state may live under several keys. Normalise to a stable shape the KDS renders.
export function normalizeBoard(res: any): KdsTicket[] {
  const raw = Array.isArray(res) ? res : res?.tickets ?? res?.board ?? res?.items ?? [];
  return (raw as any[]).map((t: any, ti: number) => {
    const rawItems: any[] = Array.isArray(t.items) ? t.items : t.lines ?? [];
    const items: KdsItem[] = rawItems.map((it: any, i: number) => ({
      index: it.index ?? it.itemIndex ?? i,
      name: it.name ?? it.itemName ?? 'Item',
      station: (it.station ?? it.line ?? 'kitchen').toString().toLowerCase(),
      status: normalizeStatus(it.status ?? it.state),
    }));
    const recv =
      t.receivedAt ?? t.firedAt ?? t.createdAt ?? t.at ?? t.ts ?? undefined;
    return {
      id: (t.id ?? t.ticketId ?? t.orderId ?? `tk-${ti}`).toString(),
      orderId: t.orderId,
      table: (t.table ?? t.tableId ?? t.table?.id)?.toString(),
      items,
      receivedAt: typeof recv === 'number' ? recv : recv ? Date.parse(recv) : undefined,
      done: items.length > 0 && items.every((x) => x.status === 'ready'),
    };
  });
}

function normalizeStatus(s: any): ItemStatus {
  const v = (s ?? 'new').toString().toLowerCase();
  if (v.startsWith('ready') || v === 'done' || v === 'bumped') return 'ready';
  if (v.startsWith('prep') || v === 'cooking' || v === 'in_progress' || v === 'started')
    return 'preparing';
  return 'new';
}

// The local optimistic step: new -> preparing -> ready.
export function nextStatus(s: ItemStatus): ItemStatus {
  return s === 'new' ? 'preparing' : s === 'preparing' ? 'ready' : 'ready';
}

// Derive the all-day rail (dish -> count of not-yet-ready items) from the board,
// used as a fallback / merge with the /all-day endpoint.
export function deriveAllDay(tickets: KdsTicket[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tickets)
    for (const it of t.items)
      if (it.status !== 'ready') out[it.name] = (out[it.name] || 0) + 1;
  return out;
}
