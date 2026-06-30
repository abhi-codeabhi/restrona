// Shared-table session domain — the differentiator: group ordering + auto split.
import { Money, newId } from '#core';

export function openSession({ tenantId, tableId, participants, id = newId('ses') }) {
  return { id, tenantId, tableId, participants, items: [] };
}

export function addSharedItem(session, { participantId, name, priceMinor, shared = false }) {
  const item = {
    id: newId('it'),
    participantId: shared ? null : participantId,
    name,
    price: new Money(priceMinor, 'INR'),
    shared: !!shared,
  };
  return { ...session, items: [...session.items, item] };
}

/**
 * Split the bill. mode 'by_item' = pay for your own items + an equal share of
 * shared items; mode 'even' = split the whole bill equally. GST applied on top.
 * Returns { participantId: Money }.
 */
export function computeSplit(session, { mode = 'by_item', gstPct = 5 } = {}) {
  const per = {};
  const n = session.participants.length || 1;
  session.participants.forEach((p) => { per[p.id] = Money.zero('INR'); });

  if (mode === 'even') {
    const sum = session.items.reduce((m, i) => m.add(i.price), Money.zero('INR'));
    const withTax = sum.add(sum.percent(gstPct));
    const each = Math.round(withTax.minor / n);
    session.participants.forEach((p) => { per[p.id] = new Money(each, 'INR'); });
    return per;
  }

  const sharedTotal = session.items.filter((i) => i.shared).reduce((m, i) => m.add(i.price), Money.zero('INR'));
  const sharePerHead = Math.round(sharedTotal.minor / n);
  session.items.forEach((i) => {
    if (!i.shared && per[i.participantId] !== undefined) per[i.participantId] = per[i.participantId].add(i.price);
  });
  session.participants.forEach((p) => {
    const base = per[p.id].add(new Money(sharePerHead, 'INR'));
    per[p.id] = base.add(base.percent(gstPct)); // GST on each share
  });
  return per;
}
