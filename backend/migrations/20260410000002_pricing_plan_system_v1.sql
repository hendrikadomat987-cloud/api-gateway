-- =============================================================================
-- Migration: 20260410000002_pricing_plan_system_v1.sql
-- Pricing & Plan System V1
--
-- Adds a structured pricing layer on top of the existing feature toggle system.
-- Plans define a baseline of domains + features. Tenant overrides (tenant_features,
-- tenant_domains) remain in place and take precedence over the plan baseline.
--
-- Resolution order at runtime:
--   1. Plan features (plan_features joined via plan_domains domain check)
--   2. Manual overrides (tenant_features.enabled = true, domain check required)
--   3. Explicit disables (tenant_features.enabled = false) win over plan
--
-- New tables:
--   plans          — global catalogue of available plans
--   plan_domains   — which domains a plan includes (many-to-many, global)
--   plan_features  — which features a plan grants (many-to-many, global)
--   tenant_plans   — which plan a tenant is on (one per tenant, RLS-protected)
--
-- Schema note:
--   This migration references the actual deployed column names:
--   domains.key, features.key (NOT domain_key / feature_key)
--   which are the columns present in the live database.
--
-- Idempotent: safe to re-run (uses IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- =============================================================================


-- ===========================================================================
-- TABLE: plans  (global catalogue)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS plans (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    key        TEXT        NOT NULL UNIQUE,
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plans_key ON plans (key);


-- ===========================================================================
-- TABLE: plan_domains  (global: plan ↔ domain many-to-many)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS plan_domains (
    plan_id   UUID NOT NULL REFERENCES plans   (id) ON DELETE CASCADE,
    domain_id UUID NOT NULL REFERENCES domains (id) ON DELETE CASCADE,

    PRIMARY KEY (plan_id, domain_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_domains_plan_id   ON plan_domains (plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_domains_domain_id ON plan_domains (domain_id);


-- ===========================================================================
-- TABLE: plan_features  (global: plan ↔ feature many-to-many)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS plan_features (
    plan_id    UUID NOT NULL REFERENCES plans    (id) ON DELETE CASCADE,
    feature_id UUID NOT NULL REFERENCES features (id) ON DELETE CASCADE,

    PRIMARY KEY (plan_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_features_plan_id    ON plan_features (plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_features_feature_id ON plan_features (feature_id);


-- ===========================================================================
-- TABLE: tenant_plans  (tenant-scoped: which plan a tenant is on)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS tenant_plans (
    tenant_id   UUID        NOT NULL PRIMARY KEY,
    plan_id     UUID        NOT NULL REFERENCES plans (id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_plans_plan_id ON tenant_plans (plan_id);

ALTER TABLE tenant_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_plans FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_plans_tenant_isolation ON tenant_plans;
CREATE POLICY tenant_plans_tenant_isolation ON tenant_plans
    USING      (tenant_id::text = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));


-- ===========================================================================
-- SEED: Plans
-- ===========================================================================

INSERT INTO plans (key, name) VALUES
    ('starter',    'Starter'),
    ('pro',        'Pro'),
    ('enterprise', 'Enterprise')
ON CONFLICT (key) DO NOTHING;


-- ===========================================================================
-- SEED: plan_domains
--
-- starter:    voice
-- pro:        voice + booking + salon
-- enterprise: voice + booking + restaurant + salon
-- ===========================================================================

INSERT INTO plan_domains (plan_id, domain_id)
SELECT p.id, d.id FROM plans p, domains d
WHERE (p.key, d.key) IN (
    ('starter',    'voice'),
    ('pro',        'voice'),
    ('pro',        'booking'),
    ('pro',        'salon'),
    ('enterprise', 'voice'),
    ('enterprise', 'booking'),
    ('enterprise', 'restaurant'),
    ('enterprise', 'salon')
)
ON CONFLICT DO NOTHING;


-- ===========================================================================
-- SEED: plan_features
--
-- starter:    voice.core + voice.callback
-- pro:        voice.* + booking.* + salon.*
-- enterprise: all features
--
-- Uses actual column name: features.key
-- ===========================================================================

-- Starter
INSERT INTO plan_features (plan_id, feature_id)
SELECT p.id, f.id FROM plans p, features f
WHERE p.key = 'starter'
  AND f.key IN ('voice.core', 'voice.callback')
ON CONFLICT DO NOTHING;

-- Pro
INSERT INTO plan_features (plan_id, feature_id)
SELECT p.id, f.id FROM plans p, features f
WHERE p.key = 'pro'
  AND f.key IN (
      'voice.core', 'voice.callback',
      'booking.core', 'booking.availability', 'booking.faq',
      'salon.core', 'salon.booking', 'salon.availability'
  )
ON CONFLICT DO NOTHING;

-- Enterprise: all active features
INSERT INTO plan_features (plan_id, feature_id)
SELECT p.id, f.id FROM plans p, features f
WHERE p.key = 'enterprise'
ON CONFLICT DO NOTHING;
