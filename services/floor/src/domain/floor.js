// Floor/Table domain — pure aggregate. One Floor doc per tenant. No I/O, no framework.
// Models the dining-room floor plan: a set of tables, each with a live status,
// the order it's currently holding, and the waiter assigned to it.
import { DomainError } from '#core';

// Table status lifecycle as seen from the floor (not the kitchen order machine).
export const STATUS = ['free', 'seated', 'cooking', 'ready', 'billing'];

const FLOOR_ID = 'floor';

function findTable(floor, n) {
  const table = floor.tables.find((t) => t.n === n);
  if (!table) throw new DomainError('TABLE_NOT_FOUND', `Table ${n} is not on this floor`);
  return table;
}

export function createFloor({ tableNumbers = [] } = {}) {
  const seen = new Set();
  const tables = [];
  for (const n of tableNumbers) {
    if (seen.has(n)) throw new DomainError('DUPLICATE_TABLE', `Table ${n} listed more than once`);
    seen.add(n);
    tables.push({ n, status: 'free', order: null, waiterId: null });
  }
  return { id: FLOOR_ID, tables };
}

export function setStatus(floor, n, status) {
  if (!STATUS.includes(status)) throw new DomainError('INVALID_STATUS', `Unknown table status: ${status}`);
  const table = findTable(floor, n);
  table.status = status;
  return floor;
}

export function seat(floor, n) {
  return setStatus(floor, n, 'seated');
}

export function assign(floor, n, waiterId) {
  const table = findTable(floor, n);
  table.waiterId = waiterId;
  return floor;
}

// Move the live order from one table to another, or swap two occupied tables.
// If the destination is free  -> MOVE: dst takes src's status/order/waiterId, src resets.
// If the destination is busy  -> SWAP: exchange status/order/waiterId between the two.
export function moveOrSwap(floor, srcN, dstN) {
  if (srcN === dstN) throw new DomainError('INVALID_MOVE', 'Source and destination are the same table');
  const src = findTable(floor, srcN);
  const dst = findTable(floor, dstN);
  if (src.status === 'free') throw new DomainError('NOTHING_TO_MOVE', `Table ${srcN} is free — nothing to move`);

  if (dst.status === 'free') {
    dst.status = src.status;
    dst.order = src.order;
    dst.waiterId = src.waiterId;
    src.status = 'free';
    src.order = null;
    src.waiterId = null;
    return { floor, verb: 'moved' };
  }

  const tmp = { status: dst.status, order: dst.order, waiterId: dst.waiterId };
  dst.status = src.status;
  dst.order = src.order;
  dst.waiterId = src.waiterId;
  src.status = tmp.status;
  src.order = tmp.order;
  src.waiterId = tmp.waiterId;
  return { floor, verb: 'swapped' };
}
