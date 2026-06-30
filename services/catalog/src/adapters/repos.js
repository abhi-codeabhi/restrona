// Outbound adapters — in-memory repositories implementing the domain ports.
// Data is partitioned by tenantId: the isolation guarantee in miniature.
// Prod: swap for a Postgres repo with RLS (T1) / schema (T2) / dedicated DB (T3).

class TenantPartitionedStore {
  #d = new Map(); // tenantId -> Map(id -> entity)
  #b(t) { if (!this.#d.has(t.tenantId)) this.#d.set(t.tenantId, new Map()); return this.#d.get(t.tenantId); }
  async save(t, e) { this.#b(t).set(e.id, e); return e; }
  async findById(t, id) { return this.#b(t).get(id) ?? null; }
  async list(t) { return [...this.#b(t).values()]; }
}

export class InMemoryItemRepository extends TenantPartitionedStore {}
