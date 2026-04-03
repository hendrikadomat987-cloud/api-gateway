/**
 * Lightweight helpers for normalizing upstream responses and asserting safe shapes.
 *
 * Used by dispatch.ts to normalize real-world edge cases and by smoke checks
 * to assert that responses meet the expected contract.
 */

// ── Response normalization ────────────────────────────────────────────────────

/**
 * Returned when upstream sends an empty body on a 2xx response.
 * Treats it as a successful no-content response.
 */
export function normalizeEmptyResponse(): Record<string, unknown> {
  return { success: true, data: null };
}

/**
 * Returned when upstream sends a non-JSON or malformed-JSON body on a 2xx response.
 * The raw content is intentionally discarded — it may contain internal service details.
 */
export function normalizeRawTextResponse(_raw: string): Record<string, unknown> {
  return { success: true, data: null };
}

// ── Response assertion ────────────────────────────────────────────────────────

/**
 * Type-guard: returns true if `body` is a non-null, non-array JSON object.
 * Use in smoke checks to verify that a response looks structurally valid.
 */
export function assertSafeJsonLikeResponse(body: unknown): body is Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

// ── Upstream status classification ────────────────────────────────────────────

/**
 * Maps an upstream HTTP status to the client-facing status code and error code.
 *
 * Rules:
 *   5xx → 502  UPSTREAM_ERROR  (mask internal failures)
 *   4xx → preserved as UPSTREAM_ERROR (pass client-relevant errors through)
 */
export function classifyUpstreamStatus(httpStatus: number): {
  clientStatus: number;
  code: string;
} {
  if (httpStatus >= 500) return { clientStatus: 502, code: 'UPSTREAM_ERROR' };
  return { clientStatus: httpStatus, code: 'UPSTREAM_ERROR' };
}
