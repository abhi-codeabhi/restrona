// CRM/Loyalty application layer — use cases orchestrate domain + ports.
// Depend on PORTS (guests repo, outbox, clock), not implementations.
// Local event taxonomy + validators keep this context self-contained.
import { ok, err, ValidationError, NotFoundError, newId } from '#core';
import { createGuest, recordVisit, setPreferences } from '../domain/guest.js';
import { digitalChit } from '../domain/chit.js';

/* ---------- Event taxonomy: restorna.<context>.<aggregate>.<event>.vN ---------- */
export const EVENTS = Object.freeze({
  GuestUpserted: 'restorna.crm.guest.upserted.v1',
  VisitRecorded: 'restorna.crm.visit.recorded.v1',
  PreferenceUpdated: 'restorna.crm.preference.updated.v1',
});

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

/* ---------- Command validators ---------- */
export function validateUpsertGuest(input) {
  if (!input || typeof input !== 'object') return err(new ValidationError('Request body required'));
  const e = [];
  if (!input.name || typeof input.name !== 'string') e.push('name is required');
  return e.length ? err(new ValidationError('Invalid guest', e)) : ok(input);
}

export function makeCrmUseCases({ guests, outbox, clock }) {
  return {
    async upsertGuest(tenant, input) {
      const v = validateUpsertGuest(input);
      if (!v.ok) return v;
      const guest = createGuest({ name: v.value.name, phone: v.value.phone ?? null });
      await guests.save(tenant, guest);
      outbox.add(evt(EVENTS.GuestUpserted, tenant.tenantId, { guestId: guest.id, name: guest.name }));
      return ok(guest);
    },

    async recordVisit(tenant, { guestId, spentMinor = 0, items = [] }) {
      const existing = await guests.findById(tenant, guestId);
      if (!existing) return err(new NotFoundError(`Guest ${guestId} not found`));
      const visitAt = clock.now().toISOString();
      const updated = recordVisit(existing, { spentMinor, items, visitAt });
      await guests.save(tenant, updated);
      outbox.add(evt(EVENTS.VisitRecorded, tenant.tenantId, {
        guestId, spentMinor, items, visits: updated.visits,
      }));
      return ok(updated);
    },

    async setPreferences(tenant, { guestId, allergies, prefs }) {
      const existing = await guests.findById(tenant, guestId);
      if (!existing) return err(new NotFoundError(`Guest ${guestId} not found`));
      const updated = setPreferences(existing, { allergies, prefs });
      await guests.save(tenant, updated);
      outbox.add(evt(EVENTS.PreferenceUpdated, tenant.tenantId, {
        guestId, allergies: updated.allergies, prefs: updated.prefs,
      }));
      return ok(updated);
    },

    async getChit(tenant, { guestId }) {
      const guest = await guests.findById(tenant, guestId);
      if (!guest) return err(new NotFoundError(`Guest ${guestId} not found`));
      return ok(digitalChit(guest));
    },
  };
}
