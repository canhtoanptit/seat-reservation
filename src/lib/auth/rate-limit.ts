/**
 * In-memory token bucket rate limiter. Single-node only. See ADR 0007.
 *
 * Keyed by an arbitrary string (we use "ip:<addr>" and "email:<addr>"
 * separately, both must be under-quota).
 *
 * Lazy eviction: stale entries are dropped on access. A future improvement is
 * a periodic sweep to bound memory, but at this scale it's not needed.
 */

type Bucket = {
  count: number;
  resetAt: number; // epoch ms
};

const buckets = new Map<string, Bucket>();

type Limit = {
  max: number;
  windowMs: number;
};

export const LIMITS: Record<"ipEmail" | "ip", Limit> = {
  // Per (IP, email): 5 failures per 15 min
  ipEmail: { max: 5, windowMs: 15 * 60 * 1000 },
  // Per IP: 30 attempts per 15 min (defends shared-NAT cases)
  ip: { max: 30, windowMs: 15 * 60 * 1000 },
};

/** Returns true if the key has remaining capacity. Does not consume. */
export function allow(key: string, limit: Limit): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) return true;
  return b.count < limit.max;
}

/** Record a failed attempt; consume capacity. */
export function recordFailure(key: string, limit: Limit): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return;
  }
  b.count += 1;
}

/** Reset a key (call after a successful login). */
export function reset(key: string): void {
  buckets.delete(key);
}

/** Test-only: wipe all buckets. */
export function _reset(): void {
  buckets.clear();
}
