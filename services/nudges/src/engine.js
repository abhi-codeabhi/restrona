const LABELS = {
  greet: 'Greet the guests',
  checkin: 'Ask how the food is',
  anything: 'Check if they need anything',
};

// Determine the single most urgent nudge for one table, or null.
// Priority: greet > checkin > anything.
function nudgeForTable(table, now, config) {
  const {
    n,
    seatedAt = null,
    greetedAt = null,
    lastServedAt = null,
    lastCheckinAt = null,
  } = table;

  // greet
  if (
    config.greet.enabled &&
    seatedAt != null &&
    greetedAt == null &&
    now - seatedAt >= config.greet.delaySecs * 1000
  ) {
    return { table: n, type: 'greet', label: LABELS.greet, since: seatedAt };
  }

  // checkin
  if (
    config.checkin.enabled &&
    lastServedAt != null &&
    (lastCheckinAt == null || lastCheckinAt < lastServedAt) &&
    now - lastServedAt >= config.checkin.afterServeSecs * 1000
  ) {
    return { table: n, type: 'checkin', label: LABELS.checkin, since: lastServedAt };
  }

  // anything
  if (
    config.anythingElse.enabled &&
    lastCheckinAt != null &&
    now - lastCheckinAt >= config.anythingElse.afterCheckinSecs * 1000 &&
    !(lastServedAt != null && lastServedAt > lastCheckinAt)
  ) {
    return { table: n, type: 'anything', label: LABELS.anything, since: lastCheckinAt };
  }

  return null;
}

export function buildNudges({ tables, now, config }) {
  const out = [];
  for (const table of tables || []) {
    const nudge = nudgeForTable(table, now, config);
    if (nudge) out.push(nudge);
  }
  out.sort((a, b) => a.since - b.since);
  return out;
}
