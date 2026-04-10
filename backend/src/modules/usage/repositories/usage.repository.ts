// src/modules/usage/repositories/usage.repository.ts
//
// DB access for Phase 4A: Usage Tracking, Limits, and Billing Foundation.
//
// Table overview:
//   plan_limits            — global catalogue, no RLS
//   tenant_override_limits — tenant-scoped, RLS
//   usage_events           — tenant-scoped, RLS, append-only
//   usage_counters         — tenant-scoped, RLS, upserted per period

import { withTenant } from '../../../lib/db.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EffectiveLimitRow {
  /** null = unlimited */
  limit_value: number | null;
  /** 'override' | 'plan' | 'none' */
  source: string;
}

export interface UsageCurrentRow {
  feature_key:   string;
  limit_type:    string;
  current_value: number;
  /** null = unlimited */
  limit_value:   number | null;
  period_start:  string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the first-of-month DATE string for the current UTC date, e.g. '2026-04-01'. */
export function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Appends one usage_event row and atomically upserts the usage_counter.
 * Both writes share a single withTenant transaction.
 */
export async function trackUsage(
  tenantId:   string,
  featureKey: string,
  eventType:  string,
  limitType:  string,
  value:      number = 1,
  metadata?:  Record<string, unknown>,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO usage_events (tenant_id, feature_key, event_type, value, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, featureKey, eventType, value, metadata ? JSON.stringify(metadata) : null],
    );

    const period = currentPeriodStart();
    await client.query(
      `INSERT INTO usage_counters
           (tenant_id, feature_key, limit_type, period_start, current_value, last_updated)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (tenant_id, feature_key, limit_type, period_start)
       DO UPDATE SET
           current_value = usage_counters.current_value + EXCLUDED.current_value,
           last_updated  = now()`,
      [tenantId, featureKey, limitType, period, value],
    );
  });
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Returns the effective limit for a (tenant, feature_key, limit_type) tuple.
 *
 * Resolution order:
 *   1. tenant_override_limits — row EXISTS (even with NULL value = explicit unlimited)
 *   2. plan_limits — via tenant_plans → plans → plan_limits
 *   3. No row found → { limit_value: null, source: 'none' } = unlimited
 *
 * This correctly distinguishes "override exists with NULL value" (explicit unlimited)
 * from "no override row" (fall through to plan).
 */
export async function getEffectiveLimit(
  tenantId:   string,
  featureKey: string,
  limitType:  string,
): Promise<EffectiveLimitRow> {
  return withTenant(tenantId, async (client) => {
    // 1. Check for tenant override (row presence matters, not just value)
    const overrideRes = await client.query<{ limit_value: number | null }>(
      `SELECT limit_value
       FROM tenant_override_limits
       WHERE tenant_id   = $1
         AND feature_key = $2
         AND limit_type  = $3
       LIMIT 1`,
      [tenantId, featureKey, limitType],
    );
    if (overrideRes.rows.length > 0) {
      return { limit_value: overrideRes.rows[0].limit_value, source: 'override' };
    }

    // 2. Check plan limit
    const planRes = await client.query<{ limit_value: number | null }>(
      `SELECT pl.limit_value
       FROM tenant_plans tp
       JOIN plan_limits pl ON pl.plan_id = tp.plan_id
       WHERE tp.tenant_id   = $1
         AND pl.feature_key = $2
         AND pl.limit_type  = $3
       LIMIT 1`,
      [tenantId, featureKey, limitType],
    );
    if (planRes.rows.length > 0) {
      return { limit_value: planRes.rows[0].limit_value, source: 'plan' };
    }

    // 3. No limit configured = unlimited
    return { limit_value: null, source: 'none' };
  });
}

/**
 * Returns the current usage counter value for the current billing period.
 * Returns 0 if no counter row exists yet.
 */
export async function getCurrentCounter(
  tenantId:   string,
  featureKey: string,
  limitType:  string,
): Promise<number> {
  return withTenant(tenantId, async (client) => {
    const period = currentPeriodStart();
    const result = await client.query<{ current_value: number }>(
      `SELECT current_value
       FROM usage_counters
       WHERE tenant_id    = $1
         AND feature_key  = $2
         AND limit_type   = $3
         AND period_start = $4`,
      [tenantId, featureKey, limitType, period],
    );
    return result.rows[0]?.current_value ?? 0;
  });
}

/**
 * Returns all usage counters for the current billing period, with effective limits.
 * Used by GET /api/v1/usage/current.
 */
export async function getUsageSummary(tenantId: string): Promise<UsageCurrentRow[]> {
  return withTenant(tenantId, async (client) => {
    const period = currentPeriodStart();

    const countersRes = await client.query<{
      feature_key:   string;
      limit_type:    string;
      current_value: number;
      period_start:  string;
    }>(
      `SELECT feature_key, limit_type, current_value, period_start::text
       FROM usage_counters
       WHERE tenant_id    = $1
         AND period_start = $2
       ORDER BY feature_key, limit_type`,
      [tenantId, period],
    );

    if (countersRes.rows.length === 0) return [];

    const rows: UsageCurrentRow[] = [];
    for (const row of countersRes.rows) {
      // Check override first (must detect row presence, not just value)
      const overrideRes = await client.query<{ limit_value: number | null }>(
        `SELECT limit_value
         FROM tenant_override_limits
         WHERE tenant_id   = $1
           AND feature_key = $2
           AND limit_type  = $3
         LIMIT 1`,
        [tenantId, row.feature_key, row.limit_type],
      );

      let limit_value: number | null;
      if (overrideRes.rows.length > 0) {
        limit_value = overrideRes.rows[0].limit_value;
      } else {
        const planRes = await client.query<{ limit_value: number | null }>(
          `SELECT pl.limit_value
           FROM tenant_plans tp
           JOIN plan_limits pl ON pl.plan_id = tp.plan_id
           WHERE tp.tenant_id   = $1
             AND pl.feature_key = $2
             AND pl.limit_type  = $3
           LIMIT 1`,
          [tenantId, row.feature_key, row.limit_type],
        );
        limit_value = planRes.rows[0]?.limit_value ?? null;
      }

      rows.push({ ...row, limit_value });
    }

    return rows;
  });
}

/**
 * Deletes all usage_counters rows for a tenant for the given period.
 * Does NOT delete usage_events (immutable audit log).
 */
export async function resetUsage(
  tenantId:    string,
  periodStart: string = currentPeriodStart(),
): Promise<{ deleted: number }> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      `DELETE FROM usage_counters
       WHERE tenant_id    = $1
         AND period_start = $2`,
      [tenantId, periodStart],
    );
    return { deleted: result.rowCount ?? 0 };
  });
}

// ── Override management ───────────────────────────────────────────────────────

/**
 * Upserts a tenant_override_limits row.
 * limitValue null = explicitly unlimited (wins over any plan limit).
 */
export async function setOverrideLimit(
  tenantId:   string,
  featureKey: string,
  limitType:  string,
  limitValue: number | null,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO tenant_override_limits
           (tenant_id, feature_key, limit_type, limit_value, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id, feature_key, limit_type)
       DO UPDATE SET
           limit_value = EXCLUDED.limit_value,
           updated_at  = now()`,
      [tenantId, featureKey, limitType, limitValue],
    );
  });
}

/**
 * Deletes a tenant_override_limits row (removes the override entirely).
 * After deletion, the plan limit (or unlimited) takes effect.
 */
export async function deleteOverrideLimit(
  tenantId:   string,
  featureKey: string,
  limitType:  string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `DELETE FROM tenant_override_limits
       WHERE tenant_id   = $1
         AND feature_key = $2
         AND limit_type  = $3`,
      [tenantId, featureKey, limitType],
    );
  });
}
