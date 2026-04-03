-- =============================================================================
-- Migration: 20260402000000_voice_callback_requests.sql
-- Voice V1 — callback request persistence
-- Multi-tenant: tenant isolation via current_setting('app.current_tenant', true)
-- Service role does NOT bypass RLS (FORCE ROW LEVEL SECURITY)
-- =============================================================================


-- ===========================================================================
-- TABLE: voice_callback_requests
-- ===========================================================================

CREATE TABLE voice_callback_requests (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    voice_call_id    UUID        NOT NULL,
    voice_session_id UUID        NOT NULL,
    track_type       TEXT        NOT NULL,
    caller_number    TEXT        NOT NULL,
    preferred_time   TEXT        NULL,
    notes            TEXT        NULL,
    status           TEXT        NOT NULL,
    n8n_workflow_id  TEXT        NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_voice_callback_requests_track_type
        CHECK (track_type IN ('booking', 'restaurant')),

    CONSTRAINT chk_voice_callback_requests_status
        CHECK (status IN ('pending', 'forwarded', 'completed', 'failed'))
);

-- Indexes
CREATE INDEX idx_voice_callback_requests_tenant_id
    ON voice_callback_requests (tenant_id);

CREATE INDEX idx_voice_callback_requests_voice_call_id
    ON voice_callback_requests (voice_call_id);

CREATE INDEX idx_voice_callback_requests_voice_session_id
    ON voice_callback_requests (voice_session_id);

CREATE INDEX idx_voice_callback_requests_status
    ON voice_callback_requests (tenant_id, status);


-- ===========================================================================
-- FOREIGN KEYS
-- ===========================================================================

-- voice_callback_requests → voice_calls
ALTER TABLE voice_callback_requests
    ADD CONSTRAINT fk_voice_callback_requests_voice_call_id
        FOREIGN KEY (voice_call_id) REFERENCES voice_calls (id)
        ON DELETE CASCADE;

-- voice_callback_requests → voice_sessions
ALTER TABLE voice_callback_requests
    ADD CONSTRAINT fk_voice_callback_requests_voice_session_id
        FOREIGN KEY (voice_session_id) REFERENCES voice_sessions (id)
        ON DELETE CASCADE;


-- ===========================================================================
-- ROW LEVEL SECURITY
-- ===========================================================================

ALTER TABLE voice_callback_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_callback_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY voice_callback_requests_tenant_isolation ON voice_callback_requests
    USING     (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);


-- ===========================================================================
-- END OF MIGRATION
-- ===========================================================================
