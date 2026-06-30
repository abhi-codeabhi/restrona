// Application layer — Floor use cases orchestrate the domain + ports (floor repo, outbox).
// Depend on PORTS, not impls. One Floor doc per tenant; commands mutate it and stage events.
import { ok, err, NotFoundError } from '#core';
import { createFloor, seat, assign, moveOrSwap, setStatus } from '../domain/floor.js';
import {
  EVENTS, MOVE_EVENT, evt,
  validateInitFloor, validateSeatTable, validateAssignWaiter, validateMoveTable,
} from './events.js';

const FLOOR_ID = 'floor';

export function makeFloorUseCases({ floor, outbox }) {
  async function load(tenant) {
    return floor.findById(tenant, FLOOR_ID);
  }

  return {
    async initFloor(tenant, input) {
      const v = validateInitFloor(input);
      if (!v.ok) return v;
      const doc = createFloor({ tableNumbers: v.value.tableNumbers });
      await floor.save(tenant, doc);
      outbox.add(evt(EVENTS.FloorInitialized, tenant.tenantId, { tables: doc.tables.map((t) => t.n) }));
      return ok(doc);
    },

    async seatTable(tenant, input) {
      const v = validateSeatTable(input);
      if (!v.ok) return v;
      const doc = await load(tenant);
      if (!doc) return err(new NotFoundError('Floor not initialized'));
      seat(doc, v.value.n);
      if (v.value.order !== undefined && v.value.order !== null) {
        doc.tables.find((t) => t.n === v.value.n).order = v.value.order;
      }
      await floor.save(tenant, doc);
      outbox.add(evt(EVENTS.TableSeated, tenant.tenantId, { n: v.value.n }));
      return ok(doc);
    },

    async assignWaiter(tenant, input) {
      const v = validateAssignWaiter(input);
      if (!v.ok) return v;
      const doc = await load(tenant);
      if (!doc) return err(new NotFoundError('Floor not initialized'));
      assign(doc, v.value.n, v.value.waiterId);
      await floor.save(tenant, doc);
      outbox.add(evt(EVENTS.WaiterAssigned, tenant.tenantId, { n: v.value.n, waiterId: v.value.waiterId }));
      return ok(doc);
    },

    async moveTable(tenant, input) {
      const v = validateMoveTable(input);
      if (!v.ok) return v;
      const doc = await load(tenant);
      if (!doc) return err(new NotFoundError('Floor not initialized'));
      // domain throws DomainError for illegal moves (free source, same table, etc.)
      const { floor: updated, verb } = moveOrSwap(doc, v.value.srcN, v.value.dstN);
      await floor.save(tenant, updated);
      outbox.add(evt(MOVE_EVENT[verb], tenant.tenantId, { srcN: v.value.srcN, dstN: v.value.dstN, verb }));
      return ok({ floor: updated, verb });
    },

    // Idempotently guarantee a table exists, creating the floor on first use.
    // The order-flow saga calls this so an order can seat its table even if the
    // floor was never explicitly initialized for this tenant.
    async ensureTable(tenant, { n }) {
      if (!Number.isInteger(n)) return err(new NotFoundError('A numeric table number is required'));
      let doc = await load(tenant);
      if (!doc) {
        doc = createFloor({ tableNumbers: [n] });
        await floor.save(tenant, doc);
        outbox.add(evt(EVENTS.FloorInitialized, tenant.tenantId, { tables: [n] }));
        return ok(doc);
      }
      if (!doc.tables.find((t) => t.n === n)) {
        doc.tables.push({ n, status: 'free', order: null, waiterId: null });
        await floor.save(tenant, doc);
      }
      return ok(doc);
    },

    // Set a table's live status (free|seated|cooking|ready|billing). Used by the
    // saga: 'cooking' when the kitchen receives the ticket, 'ready' when bumped.
    async setTableStatus(tenant, { n, status, order }) {
      const doc = await load(tenant);
      if (!doc) return err(new NotFoundError('Floor not initialized'));
      setStatus(doc, n, status); // domain throws DomainError for unknown status/table
      if (order !== undefined && order !== null) {
        doc.tables.find((t) => t.n === n).order = order;
      }
      await floor.save(tenant, doc);
      outbox.add(evt(EVENTS.TableSeated, tenant.tenantId, { n, status }));
      return ok(doc);
    },

    async getFloor(tenant) {
      const doc = await load(tenant);
      if (!doc) return err(new NotFoundError('Floor not initialized'));
      return ok(doc);
    },
  };
}
