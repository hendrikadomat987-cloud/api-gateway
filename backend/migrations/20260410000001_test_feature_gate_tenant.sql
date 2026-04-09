-- =============================================================================
-- Migration: 20260410000001_test_feature_gate_tenant.sql
-- Feature Gate Test Tenant — dedicated tenant for Layer-2 gating tests
--
-- Purpose:
--   Creates a minimal tenant (44444444-…) that lets the test suite exercise
--   the Layer-2 feature gate in resolve-tool.ts without relying on fragile
--   DB manipulation during test runs.
--
-- Tenant profile:
--   • Booking-track voice agent (assistant ID: test-feature-gate-assistant-001)
--   • voice domain only (voice.core + voice.callback enabled)
--   • booking.availability row with is_enabled = false
--     → check_availability and get_next_free will PASS Layer 1 (booking TOOL_REGISTRY)
--       but FAIL Layer 2 (booking.availability not in enabled feature set)
--     → /api/v1/features will NOT include booking.availability
--
-- What this enables:
--   Test A  — Layer-2 block via real VAPI webhook dispatch
--   Test B  — is_enabled = false excluded from feature list
--
-- Test env variable:
--   VAPI_FEATURE_GATE_ASSISTANT_ID = 'test-feature-gate-assistant-001'
--   TOKEN_FEATURE_GATE_TENANT      = <JWT with org_id = 44444444-…> (optional)
--
-- Idempotent: safe to re-run.
-- Runs as superuser — bypasses FORCE ROW LEVEL SECURITY intentionally.
-- =============================================================================

DO $$
DECLARE
    t_gate  CONSTANT UUID := '44444444-4444-4444-4444-444444444444';
    p_id    UUID;
    d_voice UUID;
    f_voice_core     UUID;
    f_voice_callback UUID;
    f_booking_avail  UUID;
BEGIN
    -- Guard: feature system migration must have run first.
    SELECT id INTO d_voice FROM domains WHERE domain_key = 'voice';
    IF d_voice IS NULL THEN
        RAISE NOTICE 'Feature system tables not found — skipping feature gate tenant seed (run 20260409000000 first)';
        RETURN;
    END IF;

    SELECT id INTO f_voice_core     FROM features WHERE feature_key = 'voice.core';
    SELECT id INTO f_voice_callback FROM features WHERE feature_key = 'voice.callback';
    SELECT id INTO f_booking_avail  FROM features WHERE feature_key = 'booking.availability';

    -- ── 1. voice_providers ──────────────────────────────────────────────────
    IF NOT EXISTS (SELECT 1 FROM voice_providers WHERE tenant_id = t_gate) THEN
        INSERT INTO voice_providers (tenant_id, provider_type, name, status, webhook_signing_mode)
        VALUES (t_gate, 'vapi', 'Feature Gate Test Provider', 'active', 'header')
        RETURNING id INTO p_id;
    ELSE
        SELECT id INTO p_id FROM voice_providers WHERE tenant_id = t_gate LIMIT 1;
    END IF;

    -- ── 2. voice_agents — booking track, fixed test provider_agent_id ───────
    INSERT INTO voice_agents
        (tenant_id, voice_provider_id, provider_agent_id, name, status, track_scope)
    VALUES
        (t_gate, p_id, 'test-feature-gate-assistant-001',
         'Feature Gate Test Agent', 'active', 'booking')
    ON CONFLICT (tenant_id, voice_provider_id, provider_agent_id) DO NOTHING;

    -- ── 3. tenant_domains — voice only ──────────────────────────────────────
    INSERT INTO tenant_domains (tenant_id, domain_id, is_enabled)
    VALUES (t_gate, d_voice, true)
    ON CONFLICT (tenant_id, domain_id) DO NOTHING;

    -- ── 4. tenant_features — voice.core + voice.callback (enabled) ──────────
    IF f_voice_core IS NOT NULL THEN
        INSERT INTO tenant_features (tenant_id, feature_id, is_enabled, source)
        VALUES (t_gate, f_voice_core, true, 'domain_provisioned')
        ON CONFLICT (tenant_id, feature_id) DO NOTHING;
    END IF;

    IF f_voice_callback IS NOT NULL THEN
        INSERT INTO tenant_features (tenant_id, feature_id, is_enabled, source)
        VALUES (t_gate, f_voice_callback, true, 'domain_provisioned')
        ON CONFLICT (tenant_id, feature_id) DO NOTHING;
    END IF;

    -- ── 5. tenant_features — booking.availability with is_enabled = false ────
    --
    -- This row exists in tenant_features but is disabled. Tests verify that:
    --   • Layer-2 correctly excludes it from the enabled feature set
    --   • /api/v1/features does NOT return it
    --   • Tools requiring booking.availability (check_availability, get_next_free)
    --     are blocked with the feature-not-enabled message
    --
    -- The booking domain is NOT provisioned in tenant_domains, so this row
    -- is a direct insert (not domain-provisioned in the normal sense).
    IF f_booking_avail IS NOT NULL THEN
        INSERT INTO tenant_features (tenant_id, feature_id, is_enabled, source)
        VALUES (t_gate, f_booking_avail, false, 'domain_provisioned')
        ON CONFLICT (tenant_id, feature_id) DO NOTHING;
    END IF;

END $$;
