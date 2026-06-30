// The at-the-table "Digital Chit" — a server-facing snapshot of who the guest is.
// Pure projection over the guest aggregate; no I/O.
import { avgSpend, usualItem, tier } from './guest.js';

export function digitalChit(guest) {
  return {
    name: guest.name,
    tier: tier(guest),
    visits: guest.visits,
    lastVisitAt: guest.lastVisitAt,
    avgSpend: avgSpend(guest).format(),
    usual: usualItem(guest),
    allergies: guest.allergies,
    prefs: guest.prefs,
  };
}
