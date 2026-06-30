export const DEFAULT_NUDGE_CONFIG = {
  greet:        { enabled: true, delaySecs: 30 },
  checkin:      { enabled: true, afterServeSecs: 300 },
  anythingElse: { enabled: true, afterCheckinSecs: 600 },
};

function isNonNegInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

// Deep clone a plain config object (only nested one level deep, which is all we need).
function clone(cfg) {
  const out = {};
  for (const key of Object.keys(cfg)) {
    out[key] = { ...cfg[key] };
  }
  return out;
}

// Numeric field names per config section.
const NUMERIC_FIELDS = {
  greet: 'delaySecs',
  checkin: 'afterServeSecs',
  anythingElse: 'afterCheckinSecs',
};

// Deep-merge `patch` over `base`, validating values.
// - enabled: coerced to boolean.
// - numeric field: only applied when a non-negative integer; otherwise ignored (keep base).
function mergeConfig(base, patch) {
  const out = clone(base);
  if (!patch || typeof patch !== 'object') return out;

  for (const section of Object.keys(patch)) {
    const p = patch[section];
    if (!p || typeof p !== 'object') continue;
    if (!out[section]) out[section] = {};

    if ('enabled' in p) {
      out[section].enabled = Boolean(p.enabled);
    }

    const numField = NUMERIC_FIELDS[section];
    if (numField && numField in p) {
      if (isNonNegInt(p[numField])) {
        out[section][numField] = p[numField];
      }
      // else: ignore invalid numeric value, keep previous/default.
    }
  }
  return out;
}

export function createNudgeConfigStore() {
  const byTenant = new Map();

  function get(tenant) {
    const id = tenant && tenant.tenantId;
    const stored = byTenant.get(id);
    return mergeConfig(DEFAULT_NUDGE_CONFIG, stored);
  }

  function set(tenant, patch) {
    const id = tenant && tenant.tenantId;
    const current = byTenant.get(id) || DEFAULT_NUDGE_CONFIG;
    const merged = mergeConfig(current, patch);
    byTenant.set(id, merged);
    return clone(merged);
  }

  return { get, set };
}
