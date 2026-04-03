-- =============================================================================
-- Migration: 20260401000000_voice_v1_initial.sql
-- Voice V1 — initial tables, indexes, foreign keys, check constraints, RLS
-- Multi-tenant: tenant isolation via current_setting('app.current_tenant', true)
-- Service role does NOT bypass RLS (FORCE ROW LEVEL SECURITY on all tables)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- EXTENSIONS (idempotent)
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()


-- ===========================================================================
-- TABLE: voice_providers
-- ===========================================================================

CREATE TABLE voice_providers (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID        NOT NULL,
    provider_type        TEXT        NOT NULL,
    name                 TEXT        NOT NULL,
    status               TEXT        NOT NULL,
    config_ref           TEXT        NULL,
    webhook_signing_mode TEXT        NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_voice_providers_status
        CHECK (status IN ('active', 'inactive', 'disabled')),

    CONSTRAINT chk_voice_providers_provider_type
        CHECK (provider_type IN ('vapi'))
);

-- Indexes
CREATE INDEX idx_voice_providers_tenant_id
    ON voice_providers (tenant_id);

CREATE INDEX idx_voice_providers_tenant_provider_type_status
    ON voice_providers (tenant_id, provider_type, status);


-- ===========================================================================
-- TABLE: voice_agents
-- ===========================================================================

CREATE TABLE voice_agents (
    id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                  UUID        NOT NULL,
    voice_provider_id          UUID        NOT NULL,
    provider_agent_id          TEXT        NOT NULL,
    name                       TEXT        NOT NULL,
    language                   TEXT        NULL,
    status                     TEXT        NOT NULL,
    track_scope                TEXT        NULL,
    default_prompt_profile_key TEXT        NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_voice_agents_status
        CHECK (status IN ('active', 'inactive', 'draft')),

    CONSTRAINT chk_voice_agents_track_scope
        CHECK (track_scope IS NULL OR track_scope IN ('booking', 'restaurant', 'multi')),

    CONSTRAINT uq_voice_agents_tenant_provider_agent
        UNIQUE (tenant_id, voice_provider_id, provider_agent_id)
);

-- Indexes
CREATE INDEX idx_voice_agents_tenant_id
    ON voice_agents (tenant_id);

CREATE INDEX idx_voice_agents_voice_provider_id
    ON voice_agents (voice_provider_id);


-- ===========================================================================
-- TABLE: voice_numbers
-- ===========================================================================

CREATE TABLE voice_numbers (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID        NOT NULL,
    voice_provider_id  UUID        NOT NULL,
    voice_agent_id     UUID        NULL,
    phone_number       TEXT        NOT NULL,
    provider_number_id TEXT        NULL,
    status             TEXT        NOT NULL,
    is_primary         BOOLEAN     NOT NULL DEFAULT false,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_voice_numbers_status
        CHECK (status IN ('active', 'inactive', 'disabled')),

    CONSTRAINT uq_voice_numbers_tenant_phone
        UNIQUE (tenant_id, phone_number)
);

-- Indexes
CREATE INDEX idx_voice_numbers_tenant_id
    ON voice_numbers (tenant_id);

CREATE INDEX idx_voice_numbers_voice_provider_id
    ON voice_numbers (voice_provider_id);

CREATE INDEX idx_voice_numbers_voice_agent_id
    ON voice_numbers (voice_agent_id);


-- ===========================================================================
-- TABLE: voice_calls
-- ===========================================================================

CREATE TABLE voice_calls (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    voice_provider_id UUID        NOT NULL,
    voice_agent_id    UUID        NULL,
    voice_number_id   UUID        NULL,
    provider_call_id  TEXT        NOT NULL,
    direction         TEXT        NOT NULL,
    caller_number     TEXT        NULL,
    callee_number     TEXT        NULL,
    status            TEXT        NOT NULL,
    track_type        TEXT        NULL,
    started_at        TIMESTAMPTZ NULL,
    ended_at          TIMESTAMPTZ NULL,
    duration_seconds  INTEGER     NULL,
    summary           TEXT        NULL,
    fallback_reason   TEXT        NULL,
    handover_reason   TEXT        NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_voice_calls_direction
        CHECK (direction IN ('inbound', 'outbound')),

    CONSTRAINT chk_voice_calls_status
        CHECK (status IN ('created', 'ringing', 'in_progress', 'completed',
                          'failed', 'cancelled', 'fallback', 'handover')),

    CONSTRAINT chk_voice_calls_track_type
        CHECK (track_type IS NULL OR track_type IN ('booking', 'restaurant', 'unknown')),

    CONSTRAINT chk_voice_calls_duration_positive
        CHECK (duration_seconds IS NULL OR duration_seconds >= 0),

    CONSTRAINT uq_voice_calls_provider_call
        UNIQUE (voice_provider_id, provider_call_id)
);

-- Indexes
CREATE INDEX idx_voice_calls_tenant_id
    ON voice_calls (tenant_id);

CREATE INDEX idx_voice_calls_voice_provider_id
    ON voice_calls (voice_provider_id);

CREATE INDEX idx_voice_calls_voice_agent_id
    ON voice_calls (voice_agent_id);

CREATE INDEX idx_voice_calls_voice_number_id
    ON voice_calls (voice_number_id);

CREATE INDEX idx_voice_calls_status
    ON voice_calls (tenant_id, status);

CREATE INDEX idx_voice_calls_started_at
    ON voice_calls (tenant_id, started_at DESC);

CREATE INDEX idx_voice_calls_track_type
    ON voice_calls (tenant_id, track_type);


-- ===========================================================================
-- TABLE: voice_sessions
-- ===========================================================================

CREATE TABLE voice_sessions (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID        NOT NULL,
    voice_call_id          UUID        NOT NULL,
    session_key            TEXT        NULL,
    status                 TEXT        NOT NULL,
    track_type             TEXT        NOT NULL,
    current_intent         TEXT        NULL,
    current_step           TEXT        NULL,
    context_json           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    last_user_message      TEXT        NULL,
    last_assistant_message TEXT        NULL,
    started_at             TIMESTAMPTZ NULL,
    ended_at               TIMESTAMPTZ NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_voice_sessions_status
        CHECK (status IN ('active', 'awaiting_user_input', 'awaiting_confirmation',
                          'completed', 'fallback', 'handover', 'cancelled', 'failed')),

    CONSTRAINT chk_voice_sessions_track_type
        CHECK (track_type IN ('booking', 'restaurant'))
);

-- Indexes
CREATE INDEX idx_voice_sessions_tenant_id
    ON voice_sessions (tenant_id);

CREATE INDEX idx_voice_sessions_voice_call_id
    ON voice_sessions (voice_call_id);

CREATE INDEX idx_voice_sessions_status
    ON voice_sessions (tenant_id, status);

CREATE INDEX idx_voice_sessions_track_type
    ON voice_sessions (tenant_id, track_type);


-- ===========================================================================
-- TABLE: voice_events
-- ===========================================================================

CREATE TABLE voice_events (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID        NOT NULL,
    voice_call_id            UUID        NULL,
    voice_session_id         UUID        NULL,
    voice_provider_id        UUID        NOT NULL,
    provider_event_id        TEXT        NULL,
    event_type               TEXT        NOT NULL,
    event_ts                 TIMESTAMPTZ NULL,
    raw_payload_json         JSONB       NOT NULL,
    normalized_payload_json  JSONB       NULL,
    processing_status        TEXT        NOT NULL,
    processing_error_code    TEXT        NULL,
    processing_error_message TEXT        NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_voice_events_processing_status
        CHECK (processing_status IN ('received', 'normalized', 'processed',
                                     'failed', 'ignored'))
);

-- Indexes
CREATE INDEX idx_voice_events_tenant_id
    ON voice_events (tenant_id);

CREATE INDEX idx_voice_events_voice_call_id
    ON voice_events (voice_call_id);

CREATE INDEX idx_voice_events_voice_session_id
    ON voice_events (voice_session_id);

CREATE INDEX idx_voice_events_voice_provider_id
    ON voice_events (voice_provider_id);

CREATE INDEX idx_voice_events_provider_event_id
    ON voice_events (voice_provider_id, provider_event_id)
    WHERE provider_event_id IS NOT NULL;

CREATE INDEX idx_voice_events_processing_status
    ON voice_events (tenant_id, processing_status);

CREATE INDEX idx_voice_events_created_at
    ON voice_events (tenant_id, created_at DESC);

CREATE INDEX idx_voice_events_event_type
    ON voice_events (tenant_id, event_type);


-- ===========================================================================
-- TABLE: voice_tool_invocations
-- ===========================================================================

CREATE TABLE voice_tool_invocations (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    voice_call_id         UUID        NOT NULL,
    voice_session_id      UUID        NOT NULL,
    tool_name             TEXT        NOT NULL,
    track_type            TEXT        NOT NULL,
    request_payload_json  JSONB       NOT NULL,
    response_payload_json JSONB       NULL,
    status                TEXT        NOT NULL,
    error_code            TEXT        NULL,
    error_message         TEXT        NULL,
    started_at            TIMESTAMPTZ NULL,
    finished_at           TIMESTAMPTZ NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_voice_tool_invocations_track_type
        CHECK (track_type IN ('booking', 'restaurant')),

    CONSTRAINT chk_voice_tool_invocations_status
        CHECK (status IN ('started', 'succeeded', 'failed', 'cancelled'))
);

-- Indexes
CREATE INDEX idx_voice_tool_invocations_tenant_id
    ON voice_tool_invocations (tenant_id);

CREATE INDEX idx_voice_tool_invocations_voice_call_id
    ON voice_tool_invocations (voice_call_id);

CREATE INDEX idx_voice_tool_invocations_voice_session_id
    ON voice_tool_invocations (voice_session_id);

CREATE INDEX idx_voice_tool_invocations_status
    ON voice_tool_invocations (tenant_id, status);

CREATE INDEX idx_voice_tool_invocations_tool_name
    ON voice_tool_invocations (tenant_id, tool_name);


-- ===========================================================================
-- TABLE: voice_order_contexts  (optional — included; see notes below)
-- ===========================================================================

CREATE TABLE voice_order_contexts (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID        NOT NULL,
    voice_call_id      UUID        NOT NULL,
    voice_session_id   UUID        NOT NULL,
    status             TEXT        NOT NULL,
    order_context_json JSONB       NOT NULL DEFAULT '{}'::jsonb,
    confirmed_at       TIMESTAMPTZ NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_voice_order_contexts_status
        CHECK (status IN ('draft', 'awaiting_confirmation', 'confirmed',
                          'cancelled', 'failed'))
);

ALTER TABLE voice_order_contexts
    ADD CONSTRAINT uq_voice_order_contexts_voice_session_id
        UNIQUE (voice_session_id);

-- Indexes
CREATE INDEX idx_voice_order_contexts_tenant_id
    ON voice_order_contexts (tenant_id);

CREATE INDEX idx_voice_order_contexts_voice_call_id
    ON voice_order_contexts (voice_call_id);

CREATE INDEX idx_voice_order_contexts_voice_session_id
    ON voice_order_contexts (voice_session_id);


-- ===========================================================================
-- FOREIGN KEYS
-- Applied after all tables exist to avoid ordering issues.
-- ===========================================================================

-- voice_agents → voice_providers
ALTER TABLE voice_agents
    ADD CONSTRAINT fk_voice_agents_voice_provider_id
        FOREIGN KEY (voice_provider_id) REFERENCES voice_providers (id)
        ON DELETE RESTRICT;

-- voice_numbers → voice_providers
ALTER TABLE voice_numbers
    ADD CONSTRAINT fk_voice_numbers_voice_provider_id
        FOREIGN KEY (voice_provider_id) REFERENCES voice_providers (id)
        ON DELETE RESTRICT;

-- voice_numbers → voice_agents (nullable — number may be unassigned)
ALTER TABLE voice_numbers
    ADD CONSTRAINT fk_voice_numbers_voice_agent_id
        FOREIGN KEY (voice_agent_id) REFERENCES voice_agents (id)
        ON DELETE SET NULL;

-- voice_calls → voice_providers
ALTER TABLE voice_calls
    ADD CONSTRAINT fk_voice_calls_voice_provider_id
        FOREIGN KEY (voice_provider_id) REFERENCES voice_providers (id)
        ON DELETE RESTRICT;

-- voice_calls → voice_agents (nullable — agent may not be resolved at call creation)
ALTER TABLE voice_calls
    ADD CONSTRAINT fk_voice_calls_voice_agent_id
        FOREIGN KEY (voice_agent_id) REFERENCES voice_agents (id)
        ON DELETE SET NULL;

-- voice_calls → voice_numbers (nullable — number may not be stored)
ALTER TABLE voice_calls
    ADD CONSTRAINT fk_voice_calls_voice_number_id
        FOREIGN KEY (voice_number_id) REFERENCES voice_numbers (id)
        ON DELETE SET NULL;

-- voice_sessions → voice_calls
ALTER TABLE voice_sessions
    ADD CONSTRAINT fk_voice_sessions_voice_call_id
        FOREIGN KEY (voice_call_id) REFERENCES voice_calls (id)
        ON DELETE CASCADE;

-- voice_events → voice_providers
ALTER TABLE voice_events
    ADD CONSTRAINT fk_voice_events_voice_provider_id
        FOREIGN KEY (voice_provider_id) REFERENCES voice_providers (id)
        ON DELETE RESTRICT;

-- voice_events → voice_calls (nullable — event may arrive before call row exists)
ALTER TABLE voice_events
    ADD CONSTRAINT fk_voice_events_voice_call_id
        FOREIGN KEY (voice_call_id) REFERENCES voice_calls (id)
        ON DELETE SET NULL;

-- voice_events → voice_sessions (nullable)
ALTER TABLE voice_events
    ADD CONSTRAINT fk_voice_events_voice_session_id
        FOREIGN KEY (voice_session_id) REFERENCES voice_sessions (id)
        ON DELETE SET NULL;

-- voice_tool_invocations → voice_calls
ALTER TABLE voice_tool_invocations
    ADD CONSTRAINT fk_voice_tool_invocations_voice_call_id
        FOREIGN KEY (voice_call_id) REFERENCES voice_calls (id)
        ON DELETE CASCADE;

-- voice_tool_invocations → voice_sessions
ALTER TABLE voice_tool_invocations
    ADD CONSTRAINT fk_voice_tool_invocations_voice_session_id
        FOREIGN KEY (voice_session_id) REFERENCES voice_sessions (id)
        ON DELETE CASCADE;

-- voice_order_contexts → voice_calls
ALTER TABLE voice_order_contexts
    ADD CONSTRAINT fk_voice_order_contexts_voice_call_id
        FOREIGN KEY (voice_call_id) REFERENCES voice_calls (id)
        ON DELETE CASCADE;

-- voice_order_contexts → voice_sessions
ALTER TABLE voice_order_contexts
    ADD CONSTRAINT fk_voice_order_contexts_voice_session_id
        FOREIGN KEY (voice_session_id) REFERENCES voice_sessions (id)
        ON DELETE CASCADE;


-- ===========================================================================
-- ROW LEVEL SECURITY
-- FORCE ensures the service role is also bound by policies.
-- Tenant comes exclusively from current_setting — never from the payload.
--
-- Every policy includes both USING and WITH CHECK:
--   USING    — filters rows on SELECT, UPDATE, DELETE
--   WITH CHECK — enforces tenant isolation on INSERT and UPDATE writes,
--               preventing any row from being written outside the current tenant
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- voice_providers
-- ---------------------------------------------------------------------------
ALTER TABLE voice_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_providers FORCE ROW LEVEL SECURITY;

CREATE POLICY voice_providers_tenant_isolation ON voice_providers
    USING     (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ---------------------------------------------------------------------------
-- voice_agents
-- ---------------------------------------------------------------------------
ALTER TABLE voice_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_agents FORCE ROW LEVEL SECURITY;

CREATE POLICY voice_agents_tenant_isolation ON voice_agents
    USING     (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ---------------------------------------------------------------------------
-- voice_numbers
-- ---------------------------------------------------------------------------
ALTER TABLE voice_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_numbers FORCE ROW LEVEL SECURITY;

CREATE POLICY voice_numbers_tenant_isolation ON voice_numbers
    USING     (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ---------------------------------------------------------------------------
-- voice_calls
-- ---------------------------------------------------------------------------
ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_calls FORCE ROW LEVEL SECURITY;

CREATE POLICY voice_calls_tenant_isolation ON voice_calls
    USING     (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ---------------------------------------------------------------------------
-- voice_sessions
-- ---------------------------------------------------------------------------
ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY voice_sessions_tenant_isolation ON voice_sessions
    USING     (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ---------------------------------------------------------------------------
-- voice_events
-- ---------------------------------------------------------------------------
ALTER TABLE voice_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_events FORCE ROW LEVEL SECURITY;

CREATE POLICY voice_events_tenant_isolation ON voice_events
    USING     (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ---------------------------------------------------------------------------
-- voice_tool_invocations
-- ---------------------------------------------------------------------------
ALTER TABLE voice_tool_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_tool_invocations FORCE ROW LEVEL SECURITY;

CREATE POLICY voice_tool_invocations_tenant_isolation ON voice_tool_invocations
    USING     (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ---------------------------------------------------------------------------
-- voice_order_contexts
-- ---------------------------------------------------------------------------
ALTER TABLE voice_order_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_order_contexts FORCE ROW LEVEL SECURITY;

CREATE POLICY voice_order_contexts_tenant_isolation ON voice_order_contexts
    USING     (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);


-- ===========================================================================
-- NOTES
-- ===========================================================================

-- Optional table decision — voice_order_contexts
-- Included. The table captures the mutable order state accumulated across a
-- restaurant-track session before the user confirms. Without it, the session's
-- context_json would need to carry both conversation state and order state,
-- which creates a coupling risk and makes it impossible to query or audit order
-- confirmations independently. The table is safe to omit if order context is
-- managed entirely by an external order service.

-- FK nullability rationale:
--   voice_calls.voice_agent_id    — nullable: agent may not be resolved at the
--                                   moment the provider fires the call-created webhook
--   voice_calls.voice_number_id   — nullable: inbound number lookup may fail or
--                                   number may not be registered
--   voice_events.voice_call_id    — nullable: webhook events (e.g. provider health
--                                   pings) may arrive outside a call lifecycle
--   voice_events.voice_session_id — nullable: early-lifecycle events precede
--                                   session creation

-- updated_at triggers:
-- The schema declares updated_at columns but does not wire auto-update triggers
-- here to keep this migration focused on structure. Apply a shared
-- set_updated_at() trigger function (e.g. moddatetime) to all tables that
-- carry updated_at.

-- ===========================================================================
-- END OF MIGRATION
-- ===========================================================================
