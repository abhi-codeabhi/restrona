// Outbound adapters — in-memory repositories partitioned by tenantId.
// Coupons are keyed by `code` within a tenant (codes are the natural key).
// Prod: swap for a Postgres repo with RLS (T1) / schema (T2) / dedicated DB (T3).

class TenantPartitionedStore {
  #data = new Map(); // tenantId -> Map(key -> entity)
  #bucket(tenant) {
    if (!this.#data.has(tenant.tenantId)) this.#data.set(tenant.tenantId, new Map());
    return this.#data.get(tenant.tenantId);
  }
  // keyOf is overridden by subclasses that key on something other than `id`.
  keyOf(entity) { return entity.id; }
  async save(tenant, entity) { this.#bucket(tenant).set(this.keyOf(entity), entity); return entity; }
  async findByKey(tenant, key) { return this.#bucket(tenant).get(key) ?? null; }
  async list(tenant) { return [...this.#bucket(tenant).values()]; }
}

// Coupons are addressed by code within a tenant.
export class InMemoryCouponRepository extends TenantPartitionedStore {
  keyOf(coupon) { return coupon.code; }
  async findByCode(tenant, code) { return this.findByKey(tenant, code); }
}
