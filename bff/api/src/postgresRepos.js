// Durable repositories for the unified API (Supabase/Postgres, multi-tenant T1).
//
// NOT-YET-VERIFIED IN-SANDBOX: the reference sandbox has no Postgres and cannot
// reach Supabase, so this path is exercised only on deploy. It implements the
// SAME ports as the in-memory repos (save/findById/list), so the saga, use cases
// and tests are unchanged — only storage differs.
//
// Two strategies:
//  • Operational aggregates (orders, sessions, tickets, floor, bills, coupons,
//    service-requests) are document-shaped, so each is stored as a JSONB `doc`
//    keyed by (id) with a `tenant_id` column for Row-Level Security. A generic
//    Money reviver rehydrates any {minor,currency} back into a Money instance so
//    domain methods (.add/.percent/.multiply) keep working after a round-trip.
//  • The catalog reads the REAL `menu_items` table (from 002_saas_schema.sql) so
//    the customer sees the menu the owner actually uploaded — mapped to the
//    catalog domain shape.
//
// Tenancy: every statement runs inside a transaction that sets app.tenant_id via
// set_config(...) so Supabase's transaction-mode pooler (Supavisor) scopes RLS.
import { Money } from '#core';

/** Run fn(client) in a tx with app.tenant_id set for RLS. */
async function withTenantTx(pool, tenant, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(tenant.tenantId)]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Recursively rebuild Money value objects from their serialized {minor,currency}
// form. Anything else passes through untouched. Safe on arrays + nested objects.
function reviveMoney(value) {
  if (Array.isArray(value)) return value.map(reviveMoney);
  if (value && typeof value === 'object') {
    if (Number.isInteger(value.minor) && typeof value.currency === 'string') {
      return new Money(value.minor, value.currency);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = reviveMoney(v);
    return out;
  }
  return value;
}

function parseDoc(doc) {
  const obj = typeof doc === 'string' ? JSON.parse(doc) : doc;
  return reviveMoney(obj);
}

/**
 * Generic document repository: one table `<name>` with columns
 * (id text pk, tenant_id uuid, doc jsonb, updated_at timestamptz).
 * Implements save/findById/list against the active tenant under RLS.
 */
class JsonbRepo {
  #pool; #table;
  constructor(pool, table) { this.#pool = pool; this.#table = table; }

  async save(tenant, entity) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      await client.query(
        `INSERT INTO ${this.#table} (id, tenant_id, doc, updated_at)
           VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
        [entity.id, tenant.tenantId, JSON.stringify(entity)],
      );
      return entity;
    });
  }

  async findById(tenant, id) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      const { rows } = await client.query(`SELECT doc FROM ${this.#table} WHERE id = $1`, [id]);
      return rows.length ? parseDoc(rows[0].doc) : null;
    });
  }

  async list(tenant) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      const { rows } = await client.query(`SELECT doc FROM ${this.#table} ORDER BY updated_at`);
      return rows.map((r) => parseDoc(r.doc));
    });
  }
}

/**
 * Catalog repository backed by the real `menu_items` table so the customer menu
 * is the owner's uploaded menu. Maps rows <-> the catalog domain item shape.
 */
class PgMenuItemRepository {
  #pool;
  constructor(pool) { this.#pool = pool; }

  #toDomain(r) {
    return {
      id: r.id,
      name: r.name,
      categoryId: r.category_id ?? null,
      price: new Money(r.price_minor, 'INR'),
      veg: r.veg,
      tags: r.tags ?? {},
      prepMinutes: r.prep_minutes ?? 0,
      available: r.available,
    };
  }

  // Customer/owner edits go through here; `restaurant_id` defaults to the tenant's
  // first restaurant when not carried on the item (single-restaurant tenants).
  async save(tenant, item) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      const { rows: rest } = await client.query(
        'SELECT id FROM restaurants ORDER BY created_at LIMIT 1',
      );
      const restaurantId = item.restaurantId ?? rest[0]?.id ?? null;
      await client.query(
        `INSERT INTO menu_items
           (id, tenant_id, restaurant_id, category_id, name, price_minor, veg, tags, prep_minutes, available)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           category_id = EXCLUDED.category_id, name = EXCLUDED.name,
           price_minor = EXCLUDED.price_minor, veg = EXCLUDED.veg, tags = EXCLUDED.tags,
           prep_minutes = EXCLUDED.prep_minutes, available = EXCLUDED.available`,
        [
          item.id, tenant.tenantId, restaurantId, item.categoryId, item.name,
          item.price?.minor ?? item.priceMinor, item.veg ?? true,
          JSON.stringify(item.tags ?? {}), item.prepMinutes ?? null,
          item.available ?? true,
        ],
      );
      return item;
    });
  }

  async findById(tenant, id) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      const { rows } = await client.query('SELECT * FROM menu_items WHERE id = $1', [id]);
      return rows.length ? this.#toDomain(rows[0]) : null;
    });
  }

  async list(tenant) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      const { rows } = await client.query('SELECT * FROM menu_items ORDER BY sort_order, name');
      return rows.map((r) => this.#toDomain(r));
    });
  }
}

/**
 * Service-request repository — JSONB docs in `oms_requests`, plus a per-tenant
 * cooldown store (`oms_request_cooldowns`) for the waiter-call rate limit.
 */
class PgRequestRepository {
  #pool; #docs;
  constructor(pool) { this.#pool = pool; this.#docs = new JsonbRepo(pool, 'oms_requests'); }

  save(tenant, entity) { return this.#docs.save(tenant, entity); }
  findById(tenant, id) { return this.#docs.findById(tenant, id); }
  list(tenant) { return this.#docs.list(tenant); }

  async getLastAckAt(tenant, table, type) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      const { rows } = await client.query(
        'SELECT last_ack_at FROM oms_request_cooldowns WHERE k = $1', [`${table}:${type}`],
      );
      return rows.length ? Number(rows[0].last_ack_at) : null;
    });
  }

  async setLastAckAt(tenant, table, type, now) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      await client.query(
        `INSERT INTO oms_request_cooldowns (tenant_id, k, last_ack_at)
           VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, k) DO UPDATE SET last_ack_at = EXCLUDED.last_ack_at`,
        [tenant.tenantId, `${table}:${type}`, now],
      );
    });
  }
}

/**
 * Coupon repository — coupons are keyed by `code` within a tenant (natural key),
 * so this exposes findByCode (what the promotions use cases call) rather than
 * findById. Stored as JSONB in `oms_coupons` with id = code.
 */
class PgCouponRepository {
  #pool;
  constructor(pool) { this.#pool = pool; }

  async save(tenant, coupon) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      await client.query(
        `INSERT INTO oms_coupons (id, tenant_id, doc, updated_at)
           VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
        [coupon.code, tenant.tenantId, JSON.stringify(coupon)],
      );
      return coupon;
    });
  }

  async findByCode(tenant, code) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      const { rows } = await client.query('SELECT doc FROM oms_coupons WHERE id = $1', [code]);
      return rows.length ? parseDoc(rows[0].doc) : null;
    });
  }

  async list(tenant) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      const { rows } = await client.query('SELECT doc FROM oms_coupons ORDER BY updated_at');
      return rows.map((r) => parseDoc(r.doc));
    });
  }
}

/**
 * Build the full repo family backed by one Postgres pool.
 * @param {string} databaseUrl  Supabase pooler connection string
 * @param {object} [logger]
 */
export async function buildPostgresRepos(databaseUrl, logger) {
  const pgmod = await import('pg');
  const Pool = pgmod.Pool ?? pgmod.default?.Pool ?? pgmod.default;
  const pool = new Pool({
    connectionString: databaseUrl,
    // Supabase requires TLS; the pooler cert is not in the system store.
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX || 5),
  });
  pool.on('error', (e) => logger?.error?.('pg.pool.error', { error: e.message }));

  return {
    items: new PgMenuItemRepository(pool),
    orders: new JsonbRepo(pool, 'oms_orders'),
    sessions: new JsonbRepo(pool, 'oms_sessions'),
    tickets: new JsonbRepo(pool, 'oms_tickets'),
    floor: new JsonbRepo(pool, 'oms_floor'),
    bills: new JsonbRepo(pool, 'oms_bills'),
    coupons: new PgCouponRepository(pool),
    requests: new PgRequestRepository(pool),
    _pool: pool,
  };
}
