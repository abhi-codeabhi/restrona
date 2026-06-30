// Service-requests domain — rate limiting (pure). After a request is acknowledged,
// the guest cannot re-raise the SAME type from the SAME table for cooldownSecs.
// Time is passed in explicitly as `now` (epoch ms) for deterministic tests.

// True when raising is allowed: either nothing was ever acknowledged for this
// table+type, or the cooldown window has fully elapsed.
export function canRaise({ lastAckAt, now, cooldownSecs }) {
  if (!lastAckAt) return true;
  return (now - lastAckAt) / 1000 >= cooldownSecs;
}
