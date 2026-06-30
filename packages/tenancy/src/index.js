// @restorna/tenancy — tenant context propagation + isolation helpers.
// Context flows implicitly via AsyncLocalStorage; no tenantId threaded through signatures.
import { AsyncLocalStorage } from 'node:async_hooks';
import { UnauthorizedError } from '#core';

const als = new AsyncLocalStorage();

/** @typedef {{tenantId:string, tier:'T1_POOLED'|'T2_SCHEMA'|'T3_DATABASE', region:string}} TenantContext */

export function withTenant(ctx, fn) { return als.run(ctx, fn); }
export function currentTenant() { return als.getStore() ?? null; }
export function requireTenant() {
  const t = als.getStore();
  if (!t) throw new UnauthorizedError('No tenant context');
  return t;
}

/** Resolve a tenant context from request headers (prod: verified JWT `tid` claim). */
export function resolveTenantFromHeaders(headers) {
  const tenantId = headers['x-tenant-id'];
  if (!tenantId) return null;
  return {
    tenantId: String(tenantId),
    tier: headers['x-tenant-tier'] || 'T1_POOLED',
    region: headers['x-tenant-region'] || 'ap-mumbai-1',
  };
}

/** Tenant-scoped, version-pinned cache key (prod: Redis). */
export function cacheKey(tenantId, ...parts) {
  return ['restorna', tenantId, ...parts].join(':');
}
