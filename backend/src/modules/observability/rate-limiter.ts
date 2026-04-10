// src/modules/observability/rate-limiter.ts
//
// Lightweight in-memory rate limiter.
//
// One sliding window per key (tenant/assistantId).  Windows are lazily
// expired — no background timer is needed.  Memory is bounded because the
// number of active tenants is small compared to available heap.
//
// Only used for the voice webhook endpoint; all other routes are protected
// by JWT auth which already prevents bulk abuse.

const WINDOW_MS        = 60_000;  // 1 minute
const DEFAULT_MAX_RPM  = 60;      // 60 requests per minute per key

interface Window {
  count:       number;
  windowStart: number;
}

const _windows = new Map<string, Window>();

/**
 * Checks and increments the rate counter for `key`.
 *
 * @returns true  — request is allowed
 * @returns false — request is rate limited
 */
export function checkRateLimit(key: string, maxPerMinute = DEFAULT_MAX_RPM): boolean {
  const now    = Date.now();
  const entry  = _windows.get(key);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    _windows.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= maxPerMinute) {
    return false;
  }

  entry.count++;
  return true;
}

/** Clears all windows — only used in tests. */
export function resetRateLimiter(): void {
  _windows.clear();
}
