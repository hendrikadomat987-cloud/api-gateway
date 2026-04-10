// src/modules/observability/insights.repository.ts
//
// Phase 6: Admin insights queries against voice_runtime_events.
//
// All queries use direct pool.connect() — no RLS.

import { pool } from '../../lib/db.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RuntimeEventRow {
  id:          string;
  trace_id:    string;
  event_type:  string;
  tool_name:   string | null;
  feature_key: string | null;
  result:      string;
  error_code:  string | null;
  latency_ms:  number | null;
  payload:     Record<string, unknown>;
  created_at:  string;
}

export interface ErrorRateSummary {
  total_count: number;
  error_count: number;
  /** Percentage 0-100, null when total_count = 0 */
  error_rate_pct: number | null;
}

export interface FeatureUsageRow {
  feature_key: string;
  call_count:  number;
}

export interface LimitHitRow {
  feature_key:   string;
  blocked_count: number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns the 20 most recent runtime events for a tenant.
 */
export async function getRecentEvents(tenantId: string): Promise<RuntimeEventRow[]> {
  const client = await pool.connect();
  try {
    const r = await client.query<RuntimeEventRow>(
      `SELECT id::text, trace_id, event_type, tool_name, feature_key,
              result, error_code, latency_ms, payload, created_at::text
       FROM voice_runtime_events
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [tenantId],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

/**
 * Computes error rate over the last 24 hours.
 */
export async function getErrorRate(tenantId: string): Promise<ErrorRateSummary> {
  const client = await pool.connect();
  try {
    const r = await client.query<{
      total_count: string;
      error_count: string;
    }>(
      `SELECT COUNT(*)                                      AS total_count,
              COUNT(*) FILTER (WHERE result = 'error')     AS error_count
       FROM voice_runtime_events
       WHERE tenant_id = $1
         AND created_at > now() - interval '24 hours'`,
      [tenantId],
    );
    const row         = r.rows[0];
    const total       = parseInt(row.total_count, 10);
    const errors      = parseInt(row.error_count, 10);
    const rate        = total === 0 ? null : Math.round((errors / total) * 100);
    return { total_count: total, error_count: errors, error_rate_pct: rate };
  } finally {
    client.release();
  }
}

/**
 * Returns the top 10 most-used features (by successful tool calls).
 */
export async function getTopFeatures(tenantId: string): Promise<FeatureUsageRow[]> {
  const client = await pool.connect();
  try {
    const r = await client.query<{ feature_key: string; call_count: string }>(
      `SELECT feature_key, COUNT(*) AS call_count
       FROM voice_runtime_events
       WHERE tenant_id = $1
         AND feature_key IS NOT NULL
         AND result = 'success'
       GROUP BY feature_key
       ORDER BY call_count DESC
       LIMIT 10`,
      [tenantId],
    );
    return r.rows.map(row => ({
      feature_key: row.feature_key,
      call_count:  parseInt(row.call_count, 10),
    }));
  } finally {
    client.release();
  }
}

/**
 * Returns how many times each feature's limit was hit.
 */
export async function getLimitHits(tenantId: string): Promise<LimitHitRow[]> {
  const client = await pool.connect();
  try {
    const r = await client.query<{ feature_key: string; blocked_count: string }>(
      `SELECT feature_key, COUNT(*) AS blocked_count
       FROM voice_runtime_events
       WHERE tenant_id = $1
         AND event_type = 'limit.blocked'
         AND feature_key IS NOT NULL
       GROUP BY feature_key
       ORDER BY blocked_count DESC`,
      [tenantId],
    );
    return r.rows.map(row => ({
      feature_key:   row.feature_key,
      blocked_count: parseInt(row.blocked_count, 10),
    }));
  } finally {
    client.release();
  }
}
