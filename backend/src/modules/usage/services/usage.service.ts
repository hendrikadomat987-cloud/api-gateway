// src/modules/usage/services/usage.service.ts
//
// Phase 4A: Usage Tracking and Limit Enforcement.
//
// checkLimit()  — read-only; returns whether a tenant may execute a tool.
// track()       — write; increments counter after successful tool execution.
// The two are intentionally separate so tracking is never charged on failure.

import {
  trackUsage,
  getEffectiveLimit,
  getCurrentCounter,
  getUsageSummary,
  resetUsage,
  setOverrideLimit,
  deleteOverrideLimit,
  currentPeriodStart,
  type EffectiveLimitRow,
  type UsageCurrentRow,
} from '../repositories/usage.repository.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LimitCheckResult {
  allowed:    boolean;
  current:    number;
  /** null = unlimited */
  limit:      number | null;
  featureKey: string;
  limitType:  string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * All tool-trackable features map to this single counter bucket for Phase 4A.
 * A later phase can introduce finer-grained buckets (e.g. 'bookings_per_month').
 */
const DEFAULT_LIMIT_TYPE = 'tool_calls_per_month';

export function getLimitType(_featureKey: string): string {
  return DEFAULT_LIMIT_TYPE;
}

// ── Core operations ───────────────────────────────────────────────────────────

/**
 * Checks whether a tenant may execute a tool for the given feature.
 * Read-only — does not write to any table.
 *
 * Returns { allowed: true } when:
 *   - No limit is configured (unlimited), OR
 *   - current counter < limit_value
 *
 * Returns { allowed: false } when:
 *   - limit_value is not null AND current counter >= limit_value
 */
async function checkLimit(
  tenantId:   string,
  featureKey: string,
): Promise<LimitCheckResult> {
  const limitType = getLimitType(featureKey);

  const [effectiveLimit, current] = await Promise.all([
    getEffectiveLimit(tenantId, featureKey, limitType),
    getCurrentCounter(tenantId, featureKey, limitType),
  ]);

  const { limit_value } = effectiveLimit;
  const allowed = limit_value === null || current < limit_value;

  return { allowed, current, limit: limit_value, featureKey, limitType };
}

/**
 * Records a usage event and increments the counter for the current period.
 * Called after a tool executes successfully.
 *
 * Failures are propagated — callers should swallow them if tracking must not
 * block the primary response (see resolve-tool.ts).
 */
async function track(
  tenantId:   string,
  featureKey: string,
  eventType:  string,
  value:      number = 1,
  metadata?:  Record<string, unknown>,
): Promise<void> {
  const limitType = getLimitType(featureKey);
  await trackUsage(tenantId, featureKey, eventType, limitType, value, metadata);
}

// ── Reporting ─────────────────────────────────────────────────────────────────

async function getCurrentUsage(tenantId: string): Promise<UsageCurrentRow[]> {
  return getUsageSummary(tenantId);
}

// ── Management ────────────────────────────────────────────────────────────────

async function reset(
  tenantId:    string,
  periodStart: string = currentPeriodStart(),
): Promise<{ deleted: number }> {
  return resetUsage(tenantId, periodStart);
}

/**
 * Sets a per-tenant limit override.
 * limitValue null = explicitly unlimited (beats any plan limit).
 */
async function setOverride(
  tenantId:   string,
  featureKey: string,
  limitType:  string,
  limitValue: number | null,
): Promise<void> {
  return setOverrideLimit(tenantId, featureKey, limitType, limitValue);
}

/**
 * Removes a per-tenant limit override (plan limit / unlimited takes effect again).
 */
async function deleteOverride(
  tenantId:   string,
  featureKey: string,
  limitType:  string,
): Promise<void> {
  return deleteOverrideLimit(tenantId, featureKey, limitType);
}

// ── Export ────────────────────────────────────────────────────────────────────

export const usageService = {
  checkLimit,
  track,
  getCurrentUsage,
  reset,
  setOverride,
  deleteOverride,
  getLimitType,
  currentPeriodStart,
};
