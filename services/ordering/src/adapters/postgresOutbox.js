// Requires `npm i pg` and a Postgres/Supabase database; not runnable in the reference sandbox.
//
// NOT-YET-VERIFIED: authored against a sandbox with NO Postgres and no `pg`
// package installed. Do not import this from the test suite — `pg` is absent.
//
// Transactional outbox (CDC / relay pattern). The business write and the event
// row commit in ONE Postgres transaction, giving an atomic "write + intent to
// publish". A separate poller — a background worker, or `pg_cron` calling
// relayPending() over an HTTP/edge function — drains unpublished rows to the
// bus and stamps published_at. Delivery is at-least-once, so consumers must be
// idempotent (dedupe on the envelope `id`).
//
// Events use the CloudEvents-style envelope from '#contracts':
//   { id, type, tenantId, occurredAt, schemaVersion, payload }

export class PostgresOutbox {
  #pool;
  constructor(pool) { this.#pool = pool; }

  /**
   * Stage an event. Pass the SAME `client` that performed the business write so
   * the row commits in that transaction (true transactional outbox). With no
   * client a standalone tenant-scoped transaction is opened — still correct,
   * but not atomic with the aggregate write.
   *
   * RLS requires app.tenant_id to be set; when a client is supplied the caller
   * (e.g. PostgresOrderRepository.save) has already done `SET LOCAL`.
   */
  async add(evt, client = null) {
    const params = [evt.tenantId, aggregateOf(evt.type), evt.type, JSON.stringify(evt)];
    const sql =
      `INSERT INTO outbox (tenant_id, aggregate, type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`;

    if (client) return client.query(sql, params);

    const c = await this.#pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [evt.tenantId]);
      await c.query(sql, params);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  /**
   * Relay pending rows for ONE tenant to the bus, then mark them published.
   * `FOR UPDATE SKIP LOCKED` lets several relay workers run concurrently
   * without double-publishing. Returns the number of events published.
   *
   * Note: RLS scopes this to a single tenant, so a multi-tenant relay loops
   * over tenants (or a BYPASSRLS maintenance role handles all tenants at once).
   */
  async relayPending(bus, tenant, limit = 100) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.tenantId]);

      const { rows } = await client.query(
        `SELECT id, payload FROM outbox
          WHERE published_at IS NULL
          ORDER BY id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [limit],
      );

      for (const row of rows) {
        const evt = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        await bus.publish(evt);
        await client.query('UPDATE outbox SET published_at = now() WHERE id = $1', [row.id]);
      }

      await client.query('COMMIT');
      return rows.length;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

// Derive the aggregate name from the event type, e.g.
// 'restorna.ordering.order.placed.v1' -> 'order'.
function aggregateOf(type) {
  const parts = String(type).split('.');
  return parts[2] ?? 'unknown';
}
