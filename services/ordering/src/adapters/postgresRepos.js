// Requires `npm i pg` and a Postgres/Supabase database; not runnable in the reference sandbox.
//
// NOT-YET-VERIFIED: authored against a sandbox with NO Postgres and no `pg`
// package installed. Do not import this from the test suite — `pg` is absent.
//
// Outbound adapters — Postgres repositories implementing the SAME ports as the
// in-memory repos (save(tenant, x) / findById(tenant, id) / list(tenant)).
// Multi-tenancy = tier T1: every method opens a transaction, runs
// `SET LOCAL app.tenant_id = $1`, then its query, so Row-Level Security scopes
// the statement to the tenant. SET LOCAL is required because Supabase's pooler
// (Supavisor) runs in transaction mode — the GUC must die with the transaction.

import { Money } from '#core';

/** Run `fn(client)` inside a transaction with app.tenant_id set for RLS. */
async function withTenantTx(pool, tenant, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // set_config(setting, value, is_local=true) is parameterizable, unlike SET LOCAL.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Reconstruct a domain order (with Money value objects) from joined rows. */
function rowsToOrder(orderRow, lineRows) {
  if (!orderRow) return null;
  return {
    id: orderRow.id,
    tenantId: orderRow.tenant_id,
    tableId: orderRow.table_id,
    sessionId: orderRow.session_id,
    placedBy: orderRow.placed_by,
    status: orderRow.status,
    lines: lineRows.map((l) => ({
      id: l.id,
      menuItemId: l.menu_item_id,
      name: l.name,
      qty: l.qty,
      unitPrice: new Money(l.unit_price_minor, orderRow.currency),
    })),
    subtotal: new Money(orderRow.subtotal_minor, orderRow.currency),
    createdAt: new Date(orderRow.created_at).toISOString(),
  };
}

export class PostgresOrderRepository {
  #pool;
  constructor(pool) { this.#pool = pool; }

  // Upsert the order header + replace its lines. tenant_id is written explicitly
  // so the RLS WITH CHECK clause passes; RLS also guards cross-tenant overwrite.
  async save(tenant, order) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      await client.query(
        `INSERT INTO orders
           (id, tenant_id, table_id, session_id, placed_by, status, subtotal_minor, currency, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           table_id = EXCLUDED.table_id,
           session_id = EXCLUDED.session_id,
           placed_by = EXCLUDED.placed_by,
           status = EXCLUDED.status,
           subtotal_minor = EXCLUDED.subtotal_minor,
           currency = EXCLUDED.currency`,
        [
          order.id, tenant.tenantId, order.tableId, order.sessionId, order.placedBy,
          order.status, order.subtotal.minor, order.subtotal.currency, order.createdAt,
        ],
      );

      await client.query('DELETE FROM order_lines WHERE order_id = $1', [order.id]);
      for (const l of order.lines) {
        await client.query(
          `INSERT INTO order_lines
             (id, order_id, tenant_id, menu_item_id, name, qty, unit_price_minor)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [l.id, order.id, tenant.tenantId, l.menuItemId, l.name, l.qty, l.unitPrice.minor],
        );
      }
      return order;
    });
  }

  async findById(tenant, id) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      const { rows: orderRows } = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
      if (orderRows.length === 0) return null;
      const { rows: lineRows } = await client.query(
        'SELECT * FROM order_lines WHERE order_id = $1 ORDER BY id', [id],
      );
      return rowsToOrder(orderRows[0], lineRows);
    });
  }

  async list(tenant) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      const { rows: orderRows } = await client.query('SELECT * FROM orders ORDER BY created_at DESC');
      if (orderRows.length === 0) return [];
      const ids = orderRows.map((o) => o.id);
      const { rows: lineRows } = await client.query(
        'SELECT * FROM order_lines WHERE order_id = ANY($1) ORDER BY id', [ids],
      );
      const byOrder = new Map(orderRows.map((o) => [o.id, []]));
      for (const l of lineRows) byOrder.get(l.order_id)?.push(l);
      return orderRows.map((o) => rowsToOrder(o, byOrder.get(o.id) ?? []));
    });
  }
}

// Sessions are document-shaped (nested participants + items), so persist them as
// a single JSONB blob keyed by id. Money fields serialize via toJSON to
// {minor, currency, formatted}; we rehydrate the ones the domain needs as Money.
// (Requires an additional `sessions` table — see SUPABASE.md.)
export class PostgresSessionRepository {
  #pool;
  constructor(pool) { this.#pool = pool; }

  async save(tenant, session) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      await client.query(
        `INSERT INTO sessions (id, tenant_id, doc)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc`,
        [session.id, tenant.tenantId, JSON.stringify(session)],
      );
      return session;
    });
  }

  async findById(tenant, id) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      const { rows } = await client.query('SELECT doc FROM sessions WHERE id = $1', [id]);
      if (rows.length === 0) return null;
      return rehydrateSession(rows[0].doc);
    });
  }

  async list(tenant) {
    return withTenantTx(this.#pool, tenant, async (client) => {
      const { rows } = await client.query('SELECT doc FROM sessions');
      return rows.map((r) => rehydrateSession(r.doc));
    });
  }
}

// `doc` may come back as parsed JSON (pg parses jsonb) or as a string.
function rehydrateSession(doc) {
  const s = typeof doc === 'string' ? JSON.parse(doc) : doc;
  return {
    ...s,
    items: (s.items ?? []).map((it) => ({
      ...it,
      price: new Money(it.price.minor, it.price.currency),
    })),
  };
}
