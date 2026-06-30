// Outbound adapters — in-memory repository partitioned by tenantId, plus a per-tenant
// cooldown store (`${table}:${type}` -> lastAckAt epoch ms) used for rate limiting.
// Prod: swap for a Postgres repo with RLS (T1) / schema (T2) / dedicated DB (T3).

class TenantPartitionedStore {
  #data = new Map(); // tenantId -> Map(id -> entity)
  #cooldowns = new Map(); // tenantId -> Map(`table:type` -> lastAckAt)

  #bucket(tenant) {
    if (!this.#data.has(tenant.tenantId)) this.#data.set(tenant.tenantId, new Map());
    return this.#data.get(tenant.tenantId);
  }
  #cooldownBucket(tenant) {
    if (!this.#cooldowns.has(tenant.tenantId)) this.#cooldowns.set(tenant.tenantId, new Map());
    return this.#cooldowns.get(tenant.tenantId);
  }

  async save(tenant, entity) { this.#bucket(tenant).set(entity.id, entity); return entity; }
  async findById(tenant, id) { return this.#bucket(tenant).get(id) ?? null; }
  async list(tenant) { return [...this.#bucket(tenant).values()]; }

  // Cooldown store: last acknowledged time for a given table+type combination.
  #key(table, type) { return `${table}:${type}`; }
  async getLastAckAt(tenant, table, type) {
    return this.#cooldownBucket(tenant).get(this.#key(table, type)) ?? null;
  }
  async setLastAckAt(tenant, table, type, now) {
    this.#cooldownBucket(tenant).set(this.#key(table, type), now);
  }
}

export class InMemoryRequestRepository extends TenantPartitionedStore {}
