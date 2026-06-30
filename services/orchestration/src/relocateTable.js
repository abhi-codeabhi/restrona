// Move/swap a table AND everything attached to it. The floor move/swap only
// shuffles the floor doc; because live status is derived from each table's
// tickets, the party's orders and kitchen tickets must follow to the new table
// or the "cooking/ready" indicator (and the eventual bill) would stay behind.
import { ok } from '#core';

const label = (n) => 'T' + n;
const TMP = 'TMP_RELOCATE';

/**
 * @param {object} args { useCases:{floor,ordering,kitchen}, tenant, srcN, dstN }
 * @returns Result<{ verb:'moved'|'swapped' }>
 */
export async function relocateTable({ useCases, tenant, srcN, dstN }) {
  const { floor, ordering, kitchen } = useCases;

  const mv = await floor.moveTable(tenant, { srcN, dstN });
  if (!mv.ok) return mv;
  const verb = mv.value.verb;

  if (verb === 'swapped') {
    // src -> tmp, dst -> src, tmp -> dst (avoids the two sets colliding).
    await ordering.relocateOrders(tenant, srcN, TMP);
    await kitchen.relocateTickets(tenant, srcN, TMP);
    await ordering.relocateOrders(tenant, dstN, label(srcN));
    await kitchen.relocateTickets(tenant, dstN, label(srcN));
    await ordering.relocateOrders(tenant, TMP, label(dstN));
    await kitchen.relocateTickets(tenant, TMP, label(dstN));
  } else {
    await ordering.relocateOrders(tenant, srcN, label(dstN));
    await kitchen.relocateTickets(tenant, srcN, label(dstN));
  }
  return ok({ verb });
}
