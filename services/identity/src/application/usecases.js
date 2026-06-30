// Application layer — identity use cases. Orchestrate domain + ports; depend on PORTS, not impls.
import { ok, err, NotFoundError, ValidationError, newId } from '#core';
import { can, isValidRole, ROLES } from '../domain/rbac.js';
import { canManage } from '../domain/hierarchy.js';

// Event-name constants defined LOCALLY in this service (contracts package is not edited).
export const IDENTITY_EVENTS = {
  RoleAssigned: 'identity.role.assigned',
};

// Local event envelope helper (mirrors the platform envelope shape).
const evt = (type, tenantId, payload) => ({
  id: newId('evt'),
  type,
  tenantId,
  occurredAt: new Date().toISOString(),
  schemaVersion: 1,
  payload,
});

// Local validator for assignRole input.
function validateAssignRole(input = {}) {
  const details = [];
  if (!input.userId || !String(input.userId).trim()) details.push({ field: 'userId', message: 'userId is required' });
  if (!isValidRole(input.role)) {
    details.push({ field: 'role', message: `role must be one of: ${ROLES.join(', ')}` });
  }
  if ('restaurantIds' in input && !Array.isArray(input.restaurantIds)) {
    details.push({ field: 'restaurantIds', message: 'restaurantIds must be an array' });
  }
  if (details.length) return err(new ValidationError('Invalid role assignment', details));
  return ok(input);
}

export function makeIdentityUseCases({ users, outbox }) {
  return {
    // Assign a role (and optional restaurant scope) to a user within the tenant.
    async assignRole(tenant, input) {
      const v = validateAssignRole(input);
      if (!v.ok) return v;
      const { userId, role, restaurantIds = [] } = v.value;
      const user = {
        id: userId,
        tenantId: tenant.tenantId,
        role,
        restaurantIds: [...restaurantIds],
      };
      await users.save(tenant, user);
      outbox.add(evt(IDENTITY_EVENTS.RoleAssigned, tenant.tenantId, {
        userId, role, restaurantIds: user.restaurantIds,
      }));
      return ok(user);
    },

    // Authorization check — RBAC + ABAC. Returns { allowed: boolean }.
    async check(tenant, { subject, action, resource } = {}) {
      const allowed = can(subject, action, resource);
      return ok({ allowed });
    },

    // Hierarchy check — may actorRole manage targetRole?
    async canManageRole(tenant, { actorRole, targetRole } = {}) {
      return ok({ allowed: canManage(actorRole, targetRole) });
    },

    async getUser(tenant, id) {
      const user = await users.findById(tenant, id);
      if (!user) return err(new NotFoundError(`User ${id} not found`));
      return ok(user);
    },

    async listUsers(tenant) {
      return ok(await users.list(tenant));
    },
  };
}
