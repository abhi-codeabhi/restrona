// Outbound adapters — in-memory directory implementing the tenant-registry port.
// CONTROL PLANE: tenants are stored GLOBALLY, NOT tenant-partitioned. A single
// Map keyed by tenantId is the whole isolation story here.
// Prod: a global Postgres `tenants` table in the control-plane database.

export class InMemoryTenantDirectory {
  #data = new Map(); // tenantId -> tenant
  async save(tenant) { this.#data.set(tenant.id, tenant); return tenant; }
  async findById(id) { return this.#data.get(id) ?? null; }
  async list() { return [...this.#data.values()]; }
}
