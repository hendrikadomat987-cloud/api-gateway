-- =============================================================================
-- Migration: 20260410000000_feature_system_v1_consolidation.sql
-- Feature System V1 — consolidation and hardening
--
-- Changes in this migration:
--   1. set_updated_at() trigger function (project-wide, fulfils the note in
--      20260401000000 which deferred this to a dedicated migration).
--   2. BEFORE UPDATE triggers on all tables that carry an updated_at column.
--   3. No new tables, no FK changes, no data mutations.
--
-- Tenant FK decision (documented here, not enforced):
--   All tables in this schema use tenant_id UUID without a database-level FK
--   to a tenants table. This is deliberate:
--     • The platform provisions tenants via JWTs and application-level logic.
--       There is no `tenants` master table — tenant existence is inferred from
--       JWT claims, not from a DB row.
--     • Every other table (voice_providers, salon_bookings, etc.) follows the
--       same convention. Adding a FK only to the feature system tables would
--       create an inconsistency without adding meaningful protection.
--     • Tenant isolation is enforced by FORCE ROW LEVEL SECURITY on all
--       tenant-scoped tables, which is a stronger runtime guarantee than a FK.
--   Decision: no tenant FK introduced. Revisit only if a tenants master table
--   is added to the schema in a future phase.
-- =============================================================================


-- ===========================================================================
-- FUNCTION: set_updated_at()
--
-- Minimal trigger function to keep updated_at current on every UPDATE.
-- Does not touch created_at. Safe to apply to both RLS-protected and
-- unrestricted tables — it only writes to NEW (no reads, no policy checks).
-- ===========================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


-- ===========================================================================
-- TRIGGERS: apply set_updated_at() to every table with an updated_at column
--
-- Naming convention: trg_{table_name}_updated_at
-- Idempotent: uses DROP TRIGGER IF EXISTS before CREATE to support re-runs.
-- ===========================================================================

-- ── From 20260401000000_voice_v1_initial.sql ──────────────────────────────────

DROP TRIGGER IF EXISTS trg_voice_providers_updated_at       ON voice_providers;
DROP TRIGGER IF EXISTS trg_voice_agents_updated_at          ON voice_agents;
DROP TRIGGER IF EXISTS trg_voice_numbers_updated_at         ON voice_numbers;
DROP TRIGGER IF EXISTS trg_voice_calls_updated_at           ON voice_calls;
DROP TRIGGER IF EXISTS trg_voice_sessions_updated_at        ON voice_sessions;
DROP TRIGGER IF EXISTS trg_voice_order_contexts_updated_at  ON voice_order_contexts;

CREATE TRIGGER trg_voice_providers_updated_at
    BEFORE UPDATE ON voice_providers
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_voice_agents_updated_at
    BEFORE UPDATE ON voice_agents
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_voice_numbers_updated_at
    BEFORE UPDATE ON voice_numbers
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_voice_calls_updated_at
    BEFORE UPDATE ON voice_calls
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_voice_sessions_updated_at
    BEFORE UPDATE ON voice_sessions
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_voice_order_contexts_updated_at
    BEFORE UPDATE ON voice_order_contexts
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();


-- ── From 20260402000000_voice_callback_requests.sql ───────────────────────────

DROP TRIGGER IF EXISTS trg_voice_callback_requests_updated_at ON voice_callback_requests;

CREATE TRIGGER trg_voice_callback_requests_updated_at
    BEFORE UPDATE ON voice_callback_requests
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();


-- ── From 20260408000002_restaurant_settings.sql ───────────────────────────────

DROP TRIGGER IF EXISTS trg_restaurant_settings_updated_at ON restaurant_settings;

CREATE TRIGGER trg_restaurant_settings_updated_at
    BEFORE UPDATE ON restaurant_settings
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();


-- ── From 20260408000003_salon_domain.sql ──────────────────────────────────────

DROP TRIGGER IF EXISTS trg_salon_services_updated_at      ON salon_services;
DROP TRIGGER IF EXISTS trg_salon_stylists_updated_at      ON salon_stylists;
DROP TRIGGER IF EXISTS trg_salon_bookings_updated_at      ON salon_bookings;
DROP TRIGGER IF EXISTS trg_voice_salon_contexts_updated_at ON voice_salon_contexts;
DROP TRIGGER IF EXISTS trg_salon_settings_updated_at      ON salon_settings;

CREATE TRIGGER trg_salon_services_updated_at
    BEFORE UPDATE ON salon_services
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_salon_stylists_updated_at
    BEFORE UPDATE ON salon_stylists
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_salon_bookings_updated_at
    BEFORE UPDATE ON salon_bookings
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_voice_salon_contexts_updated_at
    BEFORE UPDATE ON voice_salon_contexts
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_salon_settings_updated_at
    BEFORE UPDATE ON salon_settings
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();


-- ── From 20260408000005_salon_schedule.sql ────────────────────────────────────

DROP TRIGGER IF EXISTS trg_salon_stylist_working_hours_updated_at ON salon_stylist_working_hours;

CREATE TRIGGER trg_salon_stylist_working_hours_updated_at
    BEFORE UPDATE ON salon_stylist_working_hours
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();


-- ── From 20260409000000_feature_system_v1.sql ─────────────────────────────────
--
-- Note: tenant_domains and tenant_features have FORCE ROW LEVEL SECURITY.
-- The trigger function only writes to NEW.updated_at (no row reads), so
-- it is unaffected by RLS policies.

DROP TRIGGER IF EXISTS trg_domains_updated_at         ON domains;
DROP TRIGGER IF EXISTS trg_features_updated_at        ON features;
DROP TRIGGER IF EXISTS trg_tenant_domains_updated_at  ON tenant_domains;
DROP TRIGGER IF EXISTS trg_tenant_features_updated_at ON tenant_features;

CREATE TRIGGER trg_domains_updated_at
    BEFORE UPDATE ON domains
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_features_updated_at
    BEFORE UPDATE ON features
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_tenant_domains_updated_at
    BEFORE UPDATE ON tenant_domains
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_tenant_features_updated_at
    BEFORE UPDATE ON tenant_features
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();


-- ===========================================================================
-- END OF MIGRATION
-- ===========================================================================
