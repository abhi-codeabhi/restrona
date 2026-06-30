// Identity domain — role management hierarchy. Pure, no I/O.
// Who may manage (create / assign / remove) whom:
//   platform > owner > manager > staff(waiter, kitchen, billing)
// Only a strictly higher role can manage a lower one. Peers cannot manage peers,
// and lower roles can never manage higher ones.
//   - platform manages everyone (including owner).
//   - owner manages everyone EXCEPT platform.
//   - manager manages the staff tier: waiter, kitchen, billing.
//   - staff roles manage no one.

import { isValidRole } from './rbac.js';

// The set of roles each actor role is allowed to manage.
const MANAGES = {
  platform: ['owner', 'manager', 'waiter', 'kitchen', 'billing'],
  owner: ['manager', 'waiter', 'kitchen', 'billing'],
  manager: ['waiter', 'kitchen', 'billing'],
  waiter: [],
  kitchen: [],
  billing: [],
};

export function canManage(actorRole, targetRole) {
  if (!isValidRole(actorRole) || !isValidRole(targetRole)) return false;
  return (MANAGES[actorRole] ?? []).includes(targetRole);
}
