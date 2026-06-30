// Local event taxonomy + envelope helper for the tenant control-plane context.
// Kept local (not in @restorna/contracts) so this service owns its own contracts.
import { newId } from '#core';

/* ---------- Event taxonomy: restorna.<context>.<aggregate>.<event>.vN ---------- */
export const EVENTS = Object.freeze({
  TenantProvisioned: 'restorna.tenant.tenant.provisioned.v1',
  UsageMetered: 'restorna.tenant.usage.metered.v1',
});

/** CloudEvents-style envelope (the `evt` helper, as used across services). */
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
