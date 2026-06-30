// Application layer — service-request use cases orchestrate domain + ports.
// Local event constants + validators only (dependency-free; no #contracts).
// Time is driven by an explicit `now` (epoch ms) on every command for determinism.
import { ok, err, DomainError, ValidationError, newId } from '#core';
import { TYPES, raise as raiseDomain, shouldEscalate, escalate, acknowledge } from '../domain/request.js';
import { canRaise } from '../domain/rateLimit.js';

// Local event constants for the service-requests bounded context.
export const EVENTS = {
  Requested: 'service.requested',
  Escalated: 'service.escalated',
  Acknowledged: 'service.acknowledged',
};

// Event envelope helper (matches the outbox `add(evt)` shape).
const evt = (type, tenantId, payload) => ({
  id: newId('evt'),
  type,
  tenantId,
  occurredAt: new Date().toISOString(),
  schemaVersion: 1,
  payload,
});

// Local validator — return Result<value, ValidationError>.
function validateRaise(input) {
  const details = [];
  if (!input || typeof input !== 'object') details.push({ field: 'input', msg: 'required' });
  const { type, table, now } = input ?? {};
  if (!table) details.push({ field: 'table', msg: 'required' });
  if (!TYPES.includes(type)) details.push({ field: 'type', msg: `must be one of ${TYPES.join(', ')}` });
  if (!Number.isFinite(now)) details.push({ field: 'now', msg: 'epoch ms required' });
  if (details.length) return err(new ValidationError('Invalid raise input', details));
  return ok(input);
}

export function makeServiceRequestUseCases({ requests, outbox, clock, settings = {} }) {
  const escalationSecs = settings.escalationSecs ?? 30;
  const cooldownSecs = settings.cooldownSecs ?? 60;

  return {
    // Raise a request. Rejected as RATE_LIMITED if the same table+type was
    // acknowledged within the cooldown window. Stages service.requested.
    async raise(tenant, input) {
      const v = validateRaise(input);
      if (!v.ok) return v;
      const { type, table, assignedTo = null, now } = v.value;

      const lastAckAt = await requests.getLastAckAt(tenant, table, type);
      if (!canRaise({ lastAckAt, now, cooldownSecs })) {
        return err(new DomainError('RATE_LIMITED', `Request '${type}' for table ${table} is in cooldown`));
      }

      const request = raiseDomain({ type, table, assignedTo, now });
      await requests.save(tenant, request);
      outbox.add(evt(EVENTS.Requested, tenant.tenantId, {
        requestId: request.id,
        type: request.type,
        table: request.table,
        assignedTo: request.assignedTo,
        state: request.state,
      }));
      return ok(request);
    },

    // Flip every assigned request past the escalation timeout to 'escalated',
    // staging service.escalated for each. Returns the list of escalated requests.
    async escalateDue(tenant, { now }) {
      const all = await requests.list(tenant);
      const escalated = [];
      for (const req of all) {
        if (shouldEscalate(req, now, escalationSecs)) {
          const updated = escalate(req);
          await requests.save(tenant, updated);
          outbox.add(evt(EVENTS.Escalated, tenant.tenantId, {
            requestId: updated.id,
            type: updated.type,
            table: updated.table,
          }));
          escalated.push(updated);
        }
      }
      return ok(escalated);
    },

    // Acknowledge / complete a request: state 'done', record cooldown for
    // table+type, stage service.acknowledged.
    async acknowledge(tenant, { requestId, now }) {
      const existing = await requests.findById(tenant, requestId);
      if (!existing) return err(new DomainError('NOT_FOUND', `Request ${requestId} not found`));
      const updated = acknowledge(existing, now);
      await requests.save(tenant, updated);
      await requests.setLastAckAt(tenant, updated.table, updated.type, now);
      outbox.add(evt(EVENTS.Acknowledged, tenant.tenantId, {
        requestId: updated.id,
        type: updated.type,
        table: updated.table,
        ackedAt: updated.ackedAt,
      }));
      return ok(updated);
    },

    // Open requests: everything not yet 'done' (assigned + escalated).
    async listOpen(tenant) {
      const all = await requests.list(tenant);
      return ok(all.filter((r) => r.state !== 'done'));
    },
  };
}
