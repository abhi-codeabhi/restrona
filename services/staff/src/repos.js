// In-memory staff repository, tenant-partitioned (mirrors the other contexts).
// Prod: Postgres `staff` table with RLS (already defined in 002_saas_schema.sql).
class TenantPartitionedStore {
  #data = new Map();
  #bucket(tenant) {
    if (!this.#data.has(tenant.tenantId)) this.#data.set(tenant.tenantId, new Map());
    return this.#data.get(tenant.tenantId);
  }
  async save(tenant, e) { this.#bucket(tenant).set(e.id, e); return e; }
  async findById(tenant, id) { return this.#bucket(tenant).get(id) ?? null; }
  async list(tenant) { return [...this.#bucket(tenant).values()]; }
}
export class InMemoryStaffRepository extends TenantPartitionedStore {}
