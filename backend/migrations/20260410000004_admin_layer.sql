-- =============================================================================
-- Migration: 20260410000004_admin_layer.sql
-- Phase 4B: Admin & Control Layer
--
-- Adds the tenant registry table used by the internal admin API.
--
-- Design:
--   • `tenants` is a global admin catalogue — NO RLS.
--     It lists known tenants; the admin layer uses it as the authoritative
--     source for GET /internal/admin/tenants.
--   • Existing tenants (provisioned before this migration) are seeded here
--     by UUID. Data for those tenants already lives in tenant_features /
--     tenant_plans / usage_counters etc.; this table adds the name/status layer.
--   • Per the consolidation note in 20260410000000: "Revisit only if a tenants
--     master table is added to the schema in a future phase." — this is that phase.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- =============================================================================


-- ===========================================================================
-- TABLE: tenants  (global admin catalogue — NO RLS)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS tenants (
    id         UUID        PRIMARY KEY,
    name       TEXT        NOT NULL DEFAULT '',
    status     TEXT        NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_tenants_status CHECK (status IN ('active', 'inactive', 'suspended'))
);

CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants (status);

-- set_updated_at trigger (function defined in 20260410000000)
DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ===========================================================================
-- SEED: known tenants
-- ===========================================================================

-- Feature Gate Test Tenant (seeded by 20260410000001)
INSERT INTO tenants (id, name, status)
VALUES ('44444444-4444-4444-4444-444444444444', 'Feature Gate Test Tenant', 'active')
ON CONFLICT DO NOTHING;
