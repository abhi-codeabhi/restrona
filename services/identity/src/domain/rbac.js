// Identity domain — RBAC + ABAC authorization. Pure, no I/O, no framework.
// Roles form a fixed set; each role maps to a set of permission strings.
// Permissions support three match shapes:
//   '*'            -> superuser, matches any action
//   'order:create' -> exact match
//   'order:*'      -> wildcard prefix, matches 'order:create', 'order:read', ...
// ABAC overlay: when a resource names a restaurantId, the subject must own it
// (subject.restaurantIds includes it) UNLESS the role is platform/owner, who
// implicitly span all of their restaurants.

export const ROLES = ['platform', 'owner', 'manager', 'waiter', 'kitchen', 'billing'];

// role -> set of granted permission strings.
export const PERMISSIONS = {
  platform: ['*'],
  owner: ['staff:manage', 'restaurant:manage', 'reports:view', 'menu:manage', 'promo:manage', 'order:*', 'bill:*', 'table:*'],
  manager: ['menu:manage', 'promo:manage', 'table:manage', 'order:read', 'bill:read', 'reports:view'],
  waiter: ['order:create', 'order:read', 'table:manage', 'service:ack'],
  kitchen: ['kds:update', 'menu:availability'],
  billing: ['bill:create', 'bill:read', 'payment:record', 'bill:split'],
};

// Roles that implicitly span every restaurant in the tenant (skip ABAC scope check).
const ALL_RESTAURANTS_ROLES = new Set(['platform', 'owner']);

// Does a single granted permission entry satisfy the requested action?
function permitsAction(granted, action) {
  if (granted === '*') return true;
  if (granted === action) return true;
  if (granted.endsWith(':*')) {
    const prefix = granted.slice(0, -1); // 'order:*' -> 'order:'
    return action.startsWith(prefix);
  }
  return false;
}

export function isValidRole(role) {
  return ROLES.includes(role);
}

export function permissionsFor(role) {
  return PERMISSIONS[role] ?? [];
}

/**
 * can(subject, action, resource) -> boolean
 *   subject  = { role, restaurantIds: [] }
 *   action   = e.g. 'staff:manage', 'order:create'
 *   resource = { restaurantId? }
 *
 * RBAC: the subject's role must grant the action (exact / wildcard / superuser).
 * ABAC: if resource.restaurantId is present, the subject must own it via
 *       restaurantIds — unless the role spans all restaurants (platform/owner).
 */
export function can(subject = {}, action, resource = {}) {
  const role = subject.role;
  if (!role) return false;

  const grants = permissionsFor(role);
  const rbacOk = grants.some((g) => permitsAction(g, action));
  if (!rbacOk) return false;

  // ABAC scope check.
  if (resource && resource.restaurantId != null) {
    if (ALL_RESTAURANTS_ROLES.has(role)) return true;
    const owned = subject.restaurantIds ?? [];
    return owned.includes(resource.restaurantId);
  }

  return true;
}
