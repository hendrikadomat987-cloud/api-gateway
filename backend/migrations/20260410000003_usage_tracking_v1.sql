-- =============================================================================
-- Migration: 20260410000003_usage_tracking_v1.sql
-- Phase 4A: Usage Tracking, Limits, and Billing Foundation
--
-- New tables:
--   plan_limits            — per-plan limits per feature key (global catalogue, no RLS)
--   tenant_override_limits — per-tenant limit overrides (RLS-protected)
--   usage_events           — immutable event log (RLS-protected, append-only)
--   usage_counters         — aggregated running totals (RLS-protected, upserted)
--
-- limit_value NULL = unlimited (no enforcement for that dimension).
-- Idempotent: safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- =============================================================================


-- ===========================================================================
-- TABLE: plan_limits  (global catalogue — no RLS)
-- ===========================================================================
-- feature_key is TEXT (not FK) — limits may be defined for feature keys that
-- are not yet in the features catalogue (e.g. future salon.booking features).
-- limit_type examples: 'tool_calls_per_month'
-- limit_value NULL = unlimited.

CREATE TABLE IF NOT EXISTS plan_limits (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id     UUID        NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
    feature_key TEXT        NOT NULL,
    limit_type  TEXT        NOT NULL,
    limit_value INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (plan_id, feature_key, limit_type)
);

CREATE INDEX IF NOT EXISTS idx_plan_limits_plan_id ON plan_limits (plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_limits_lookup  ON plan_limits (plan_id, feature_key, limit_type);


-- ===========================================================================
-- TABLE: tenant_override_limits  (tenant-scoped — RLS)
-- ===========================================================================
-- A row here always wins over plan_limits for the same (feature_key, limit_type).
-- limit_value NULL = explicitly unlimited (overrides any plan limit).

CREATE TABLE IF NOT EXISTS tenant_override_limits (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    feature_key TEXT        NOT NULL,
    limit_type  TEXT        NOT NULL,
    limit_value INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, feature_key, limit_type)
);

CREATE INDEX IF NOT EXISTS idx_tenant_override_limits_tenant
    ON tenant_override_limits (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_override_limits_lookup
    ON tenant_override_limits (tenant_id, feature_key, limit_type);

ALTER TABLE tenant_override_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_override_limits FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_override_limits_isolation ON tenant_override_limits;
CREATE POLICY tenant_override_limits_isolation ON tenant_override_limits
    USING      (tenant_id::text = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));


-- ===========================================================================
-- TABLE: usage_events  (tenant-scoped — RLS, append-only)
-- ===========================================================================
-- Immutable audit log. One row per tracked action. Never UPDATE or DELETE in prod.
-- event_type examples: 'tool_call'
-- metadata: optional JSONB (tool name, session ID, etc.)

CREATE TABLE IF NOT EXISTS usage_events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    feature_key TEXT        NOT NULL,
    event_type  TEXT        NOT NULL,
    value       INTEGER     NOT NULL DEFAULT 1,
    metadata    JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant
    ON usage_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_feature
    ON usage_events (tenant_id, feature_key, occurred_at DESC);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_events_isolation ON usage_events;
CREATE POLICY usage_events_isolation ON usage_events
    USING      (tenant_id::text = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));


-- ===========================================================================
-- TABLE: usage_counters  (tenant-scoped — RLS, upserted on every track call)
-- ===========================================================================
-- One row per (tenant_id, feature_key, limit_type, period_start).
-- period_start is the first day of the billing month (UTC), e.g. '2026-04-01'.
-- current_value is incremented atomically via ON CONFLICT DO UPDATE.

CREATE TABLE IF NOT EXISTS usage_counters (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    feature_key   TEXT        NOT NULL,
    limit_type    TEXT        NOT NULL,
    period_start  DATE        NOT NULL,
    current_value INTEGER     NOT NULL DEFAULT 0,
    last_updated  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, feature_key, limit_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_tenant
    ON usage_counters (tenant_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_usage_counters_lookup
    ON usage_counters (tenant_id, feature_key, limit_type, period_start);

ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_counters_isolation ON usage_counters;
CREATE POLICY usage_counters_isolation ON usage_counters
    USING      (tenant_id::text = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));


-- ===========================================================================
-- SEED: plan_limits
--
-- starter: 500 tool_calls_per_month for voice.core, 100 for voice.callback
-- pro:     5 000 tool_calls_per_month for all included features
-- enterprise: no rows → NULL (unlimited) for all features
-- ===========================================================================

-- Starter
INSERT INTO plan_limits (plan_id, feature_key, limit_type, limit_value)
SELECT p.id, unnest(ARRAY['voice.core', 'voice.callback']),
       'tool_calls_per_month',
       unnest(ARRAY[500, 100])
FROM plans p WHERE p.key = 'starter'
ON CONFLICT DO NOTHING;

-- Pro
INSERT INTO plan_limits (plan_id, feature_key, limit_type, limit_value)
SELECT p.id, fk, 'tool_calls_per_month', 5000
FROM plans p,
     unnest(ARRAY[
       'voice.core', 'voice.callback',
       'booking.availability', 'booking.core', 'booking.faq',
       'salon.core', 'salon.booking', 'salon.availability',
       'restaurant.core', 'restaurant.menu', 'restaurant.ordering'
     ]) AS fk
WHERE p.key = 'pro'
ON CONFLICT DO NOTHING;

-- Enterprise: no rows inserted → unlimited for all features
