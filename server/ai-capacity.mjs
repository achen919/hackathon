function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : fallback;
}

export function createAiCapacityGate({
  hourlyLimit = process.env.AI_GENERATION_PER_HOUR ?? 20,
  maxConcurrency = process.env.AI_MAX_CONCURRENCY ?? 2,
  now = Date.now,
} = {}) {
  const limit = positiveInteger(hourlyLimit, 20);
  const concurrency = positiveInteger(maxConcurrency, 2);
  let active = 0;
  let used = 0;
  let resetAt = Number(now()) + 60 * 60_000;

  function acquire() {
    const timestamp = Number(now());
    if (timestamp >= resetAt) {
      used = 0;
      resetAt = timestamp + 60 * 60_000;
    }
    if (active >= concurrency) {
      return { allowed: false, reason: 'concurrency', retryAfterSeconds: 3 };
    }
    if (used >= limit) {
      return {
        allowed: false,
        reason: 'hourly-limit',
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - timestamp) / 1_000)),
      };
    }
    active += 1;
    used += 1;
    let released = false;
    return {
      allowed: true,
      release() {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
      },
    };
  }

  return {
    acquire,
    snapshot() {
      return { active, used, hourlyLimit: limit, maxConcurrency: concurrency, resetAt };
    },
  };
}
