// Outbound adapters — in-memory Floor repository implementing the domain port.
// Data is partitioned by tenantId: the isolation guarantee in miniature.
// A tenant has exactly one Floor doc (id 'floor'); reuse the partitioned store.
// Prod: swap for a Postgres repo with RLS (T1) / schema (T2) / dedicated DB (T3).

class TenantPartitionedStore {
  #data = new Map(); // tenantId -> Map(id -> entity)
  #bucket(tenant) {
    if (!this.#data.has(tenant.tenantId)) this.#data.set(tenant.tenantId, new Map());
    return this.#data.get(tenant.tenantId);
  }
  async save(tenant, entity) { this.#bucket(tenant).set(entity.id, entity); return entity; }
  async findById(tenant, id) { return this.#bucket(tenant).get(id) ?? null; }
  async list(tenant) { return [...this.#bucket(tenant).values()]; }
}

export class InMemoryFloorRepository extends TenantPartitionedStore {}
