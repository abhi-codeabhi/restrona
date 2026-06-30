// @restorna/contracts — single source of truth for DTO validation + event schemas.
// In production these are Zod schemas that also emit OpenAPI/AsyncAPI + the SDK.
// Here: hand-rolled validators (dependency-free) returning Result, same contract shape.
// NOTE: relative import (not '#core') because this file lives in its own package scope.
// In the real monorepo this is `import { ... } from '@restorna/core'`.
import { ok, err, ValidationError, newId } from '../../core/src/index.js';

/* ---------- Event taxonomy: restorna.<context>.<aggregate>.<event>.vN ---------- */
export const EVENTS = Object.freeze({
  OrderPlaced: 'restorna.ordering.order.placed.v1',
  SessionOpened: 'restorna.ordering.session.opened.v1',
  SessionItemAdded: 'restorna.ordering.session.item_added.v1',
});

/** CloudEvents-style envelope. */
export function envelope(type, tenantId, payload) {
  return {
    id: newId('evt'),
    type,
    tenantId,
    occurredAt: new Date().toISOString(),
    schemaVersion: 1,
    payload,
  };
}

/* ---------- Command validators ---------- */
export function validatePlaceOrder(input) {
  const e = [];
  if (!input || typeof input !== 'object') return err(new ValidationError('Request body required'));
  if (!input.tableId) e.push('tableId is required');
  if (!Array.isArray(input.items) || input.items.length === 0) e.push('items must be a non-empty array');
  else input.items.forEach((it, i) => {
    if (!it.menuItemId) e.push(`items[${i}].menuItemId is required`);
    if (!Number.isInteger(it.unitPriceMinor) || it.unitPriceMinor <= 0) e.push(`items[${i}].unitPriceMinor must be a positive integer (paise)`);
    if (!Number.isInteger(it.qty) || it.qty <= 0) e.push(`items[${i}].qty must be a positive integer`);
  });
  return e.length ? err(new ValidationError('Invalid order', e)) : ok(input);
}

export function validateOpenSession(input) {
  const e = [];
  if (!input || typeof input !== 'object') return err(new ValidationError('Request body required'));
  if (!input.tableId) e.push('tableId is required');
  if (!Array.isArray(input.participants) || input.participants.length === 0) e.push('participants must be a non-empty array');
  else input.participants.forEach((p, i) => { if (!p.id) e.push(`participants[${i}].id is required`); });
  return e.length ? err(new ValidationError('Invalid session', e)) : ok(input);
}

export function validateAddSharedItem(input) {
  const e = [];
  if (!input || typeof input !== 'object') return err(new ValidationError('Request body required'));
  if (!input.name) e.push('name is required');
  if (!Number.isInteger(input.priceMinor) || input.priceMinor <= 0) e.push('priceMinor must be a positive integer (paise)');
  if (!input.shared && !input.participantId) e.push('participantId is required for non-shared items');
  return e.length ? err(new ValidationError('Invalid item', e)) : ok(input);
}
