// Staff management use cases — the manager adds/disables team members and the
// system tracks their role. Table assignment lives in the floor context
// (assignWaiter); this owns the roster.
import { ok, err, ValidationError, NotFoundError, newId } from '#core';

const ROLES = ['waiter', 'kitchen', 'cashier', 'billing', 'manager'];

export function makeStaffUseCases({ staff }) {
  return {
    async addStaff(tenant, { name, role = 'waiter' } = {}) {
      if (!name || !String(name).trim()) return err(new ValidationError('Staff name is required'));
      if (!ROLES.includes(role)) return err(new ValidationError(`role must be one of ${ROLES.join('|')}`));
      const member = { id: newId('stf'), name: String(name).trim(), role, disabled: false };
      await staff.save(tenant, member);
      return ok(member);
    },

    async listStaff(tenant) {
      return ok(await staff.list(tenant));
    },

    async disableStaff(tenant, { id }) {
      const existing = await staff.findById(tenant, id);
      if (!existing) return err(new NotFoundError(`Staff ${id} not found`));
      const updated = { ...existing, disabled: true };
      await staff.save(tenant, updated);
      return ok(updated);
    },
  };
}
