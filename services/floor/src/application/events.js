// Local event taxonomy + validators for the Floor context.
// Mirrors the shape of @restorna/contracts but is owned by this service, so the
// floor bounded context can evolve its own commands/events independently.
import { ok, err, ValidationError, newId } from '#core';

/* ---------- Event taxonomy: restorna.<context>.<aggregate>.<event>.vN ---------- */
export const EVENTS = Object.freeze({
  FloorInitialized: 'restorna.floor.floor.initialized.v1',
  TableSeated: 'restorna.floor.table.seated.v1',
  WaiterAssigned: 'restorna.floor.table.waiter_assigned.v1',
  TableMoved: 'restorna.floor.table.moved.v1',
  TableSwapped: 'restorna.floor.table.swapped.v1',
});

// Map the moveOrSwap verb to its event type.
export const MOVE_EVENT = Object.freeze({ moved: EVENTS.TableMoved, swapped: EVENTS.TableSwapped });

/** CloudEvents-style envelope helper. */
export function evt(type, tenantId, payload) {
  return {
    id: newId('evt'),
    type,
    tenantId,
    occurredAt: new Date().toISOString(),
    schemaVersion: 1,
    payload,
  };
}

/* ---------- Command validators (dependency-free, return Result) ---------- */
export function validateInitFloor(input) {
  const e = [];
  if (!input || typeof input !== 'object') return err(new ValidationError('Request body required'));
  if (!Array.isArray(input.tableNumbers) || input.tableNumbers.length === 0) {
    e.push('tableNumbers must be a non-empty array');
  } else {
    input.tableNumbers.forEach((n, i) => {
      if (!Number.isInteger(n) || n <= 0) e.push(`tableNumbers[${i}] must be a positive integer`);
    });
  }
  return e.length ? err(new ValidationError('Invalid floor', e)) : ok(input);
}

export function validateSeatTable(input) {
  const e = [];
  if (!input || typeof input !== 'object') return err(new ValidationError('Request body required'));
  if (!Number.isInteger(input.n) || input.n <= 0) e.push('n must be a positive integer');
  return e.length ? err(new ValidationError('Invalid seat request', e)) : ok(input);
}

export function validateAssignWaiter(input) {
  const e = [];
  if (!input || typeof input !== 'object') return err(new ValidationError('Request body required'));
  if (!Number.isInteger(input.n) || input.n <= 0) e.push('n must be a positive integer');
  if (!input.waiterId) e.push('waiterId is required');
  return e.length ? err(new ValidationError('Invalid assign request', e)) : ok(input);
}

export function validateMoveTable(input) {
  const e = [];
  if (!input || typeof input !== 'object') return err(new ValidationError('Request body required'));
  if (!Number.isInteger(input.srcN) || input.srcN <= 0) e.push('srcN must be a positive integer');
  if (!Number.isInteger(input.dstN) || input.dstN <= 0) e.push('dstN must be a positive integer');
  return e.length ? err(new ValidationError('Invalid move request', e)) : ok(input);
}
