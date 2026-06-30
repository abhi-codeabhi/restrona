// Promotions domain — happy hour rule. Pure, no I/O.
// A HappyHour applies a percentage discount during a weekday/time window,
// optionally scoped to a single menu category.

// Shape:
//   { days: [bool x7], from: 'HH:MM', to: 'HH:MM', pct, category, on }
// `days` is indexed Mon..Sun (0 = Monday ... 6 = Sunday).
// `category` null/undefined = applies to all categories.
export function createHappyHour({ days, from, to, pct, category = null, on = true }) {
  return { days, from, to, pct, category, on };
}

// Convert a Date to a minutes-of-day integer.
function minutesOfDay(date) {
  const d = new Date(date);
  return d.getHours() * 60 + d.getMinutes();
}

// Parse 'HH:MM' to minutes-of-day.
function parseHM(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

// JS getDay(): 0 = Sunday ... 6 = Saturday. Our days array is Mon..Sun (0..6).
function dayIndexMonFirst(date) {
  const jsDay = new Date(date).getDay(); // 0=Sun..6=Sat
  return (jsDay + 6) % 7; // 0=Mon..6=Sun
}

// Is the happy hour active at `date`? Checks the on flag, weekday, and time window.
export function isActive(hh, date = new Date()) {
  if (!hh || !hh.on) return false;
  const di = dayIndexMonFirst(date);
  if (!hh.days || !hh.days[di]) return false;
  const now = minutesOfDay(date);
  const from = parseHM(hh.from);
  const to = parseHM(hh.to);
  // Inclusive window [from, to].
  return now >= from && now <= to;
}

// Discount in minor units for a given subtotal/category at `date`.
// Returns 0 if inactive or the category does not match.
export function discountFor(hh, subtotalMinor, category = null, date = new Date()) {
  if (!isActive(hh, date)) return 0;
  if (hh.category != null && hh.category !== category) return 0;
  return Math.round((subtotalMinor * hh.pct) / 100);
}
