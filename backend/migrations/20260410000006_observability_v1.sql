-- =============================================================================
-- Migration: 20260410000006_observability_v1.sql
-- Phase 6: Observability, Monitoring & Runtime Hardening
--
-- Append-only runtime event log for voice tool executions, feature gate
-- decisions, usage limit checks, and errors.
--
-- Intentionally has no RLS — this is an internal analytics table accessed
-- only by the observability service, never through tenant-scoped queries.
--
-- trace_id = voice_session.id for tool events (groups all tool calls in a
-- single conversation), or the HTTP request ID for non-voice events.
-- =============================================================================

CREATE TABLE IF NOT EXISTS voice_runtime_events (
  id          UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  trace_id    TEXT        NOT NULL,
  event_type  TEXT        NOT NULL,
  -- event_type values:
  --   'tool.success'      — tool executed successfully
  --   'tool.error'        — tool threw / timed out
  --   'tool.timeout'      — tool exceeded timeout
  --   'feature.blocked'   — feature gate rejected the call
  --   'limit.blocked'     — usage limit gate rejected the call
  --   'limit.allowed'     — usage limit gate passed
  tool_name   TEXT,
  feature_key TEXT,
  result      TEXT        NOT NULL,
  -- result values: 'success' | 'error' | 'blocked' | 'allowed'
  error_code  TEXT,
  latency_ms  INTEGER,
  payload     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for tenant-scoped timeline queries (most common admin pattern)
CREATE INDEX IF NOT EXISTS idx_vrt_tenant_created
  ON voice_runtime_events (tenant_id, created_at DESC);

-- Index for trace correlation (session/request drill-down)
CREATE INDEX IF NOT EXISTS idx_vrt_trace_id
  ON voice_runtime_events (trace_id);

-- Index for feature analytics (most-used features, limit-hit counts)
CREATE INDEX IF NOT EXISTS idx_vrt_tenant_feature
  ON voice_runtime_events (tenant_id, feature_key, created_at DESC)
  WHERE feature_key IS NOT NULL;

-- Index for error-rate queries (last 24h errors)
CREATE INDEX IF NOT EXISTS idx_vrt_tenant_result
  ON voice_runtime_events (tenant_id, result, created_at DESC);
