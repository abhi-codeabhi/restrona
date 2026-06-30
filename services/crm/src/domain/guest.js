// CRM/Loyalty domain — pure guest aggregate. No I/O, no framework. Unit-testable.
import { Money, newId } from '#core';

export function createGuest({ name, phone }) {
  return {
    id: newId('gst'),
    name,
    phone,
    visits: 0,
    lastVisitAt: null,
    totalSpentMinor: 0,
    allergies: [],
    prefs: [],
    itemCounts: {},
  };
}

// Records a visit. lastVisitAt is supplied by the use case via the injected clock.
export function recordVisit(guest, { spentMinor = 0, items = [], visitAt = null }) {
  const itemCounts = { ...guest.itemCounts };
  for (const name of items) itemCounts[name] = (itemCounts[name] ?? 0) + 1;
  return {
    ...guest,
    visits: guest.visits + 1,
    lastVisitAt: visitAt ?? guest.lastVisitAt,
    totalSpentMinor: guest.totalSpentMinor + spentMinor,
    itemCounts,
  };
}

export function setPreferences(guest, { allergies, prefs } = {}) {
  return {
    ...guest,
    allergies: allergies ?? guest.allergies,
    prefs: prefs ?? guest.prefs,
  };
}

// The item this guest orders most, or null if they've never ordered anything.
export function usualItem(guest) {
  let best = null;
  let bestCount = 0;
  for (const [name, count] of Object.entries(guest.itemCounts)) {
    if (count > bestCount) { best = name; bestCount = count; }
  }
  return best;
}

// Average spend per visit as Money (integer minor units), or zero if no visits.
export function avgSpend(guest) {
  if (guest.visits <= 0) return Money.zero('INR');
  return new Money(Math.round(guest.totalSpentMinor / guest.visits), 'INR');
}

export function tier(guest) {
  if (guest.visits >= 10) return 'Gold';
  if (guest.visits >= 4) return 'Silver';
  return 'New';
}
