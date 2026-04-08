-- =============================================================================
-- Migration: 20260408000003_salon_domain.sql
-- Salon / FriseurSalon domain tables
-- Multi-tenant: tenant isolation via RLS (same pattern as restaurant domain)
-- =============================================================================


-- ===========================================================================
-- TABLE: salon_services  (service catalogue — analogous to restaurant_menu_items)
-- ===========================================================================

CREATE TABLE salon_services (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    category         TEXT        NOT NULL DEFAULT 'Allgemein',
    name             TEXT        NOT NULL,
    description      TEXT        NULL,
    duration_minutes INTEGER     NOT NULL,
    price_cents      INTEGER     NOT NULL,
    is_active        BOOLEAN     NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_salon_services_duration CHECK (duration_minutes > 0),
    CONSTRAINT chk_salon_services_price    CHECK (price_cents >= 0)
);

CREATE INDEX idx_salon_services_tenant_id        ON salon_services (tenant_id);
CREATE INDEX idx_salon_services_tenant_active     ON salon_services (tenant_id, is_active);
CREATE INDEX idx_salon_services_tenant_category   ON salon_services (tenant_id, category);

-- RLS
ALTER TABLE salon_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_services FORCE ROW LEVEL SECURITY;

CREATE POLICY salon_services_tenant_isolation ON salon_services
    USING (tenant_id::text = current_setting('app.current_tenant', true));


-- ===========================================================================
-- TABLE: salon_stylists  (staff / employees)
-- ===========================================================================

CREATE TABLE salon_stylists (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL,
    name       TEXT        NOT NULL,
    specialty  TEXT        NULL,
    is_active  BOOLEAN     NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_salon_stylists_tenant_id    ON salon_stylists (tenant_id);
CREATE INDEX idx_salon_stylists_tenant_active ON salon_stylists (tenant_id, is_active);

ALTER TABLE salon_stylists ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_stylists FORCE ROW LEVEL SECURITY;

CREATE POLICY salon_stylists_tenant_isolation ON salon_stylists
    USING (tenant_id::text = current_setting('app.current_tenant', true));


-- ===========================================================================
-- TABLE: salon_bookings  (confirmed appointments — analogous to restaurant_orders)
-- ===========================================================================

CREATE TABLE salon_bookings (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'draft',
    source              TEXT        NOT NULL DEFAULT 'voice',
    customer_name       TEXT        NULL,
    customer_phone      TEXT        NULL,
    -- Soft reference: no FK constraint — stylist preference is informational.
    -- A hard FK would cause errors when a spoken stylist name resolves to a
    -- non-existent ID, or when stylists are deactivated post-booking.
    -- Validation happens at the scheduling layer (Phase 2).
    stylist_id          UUID        NULL,
    appointment_start   TIMESTAMPTZ NULL,
    appointment_end     TIMESTAMPTZ NULL,
    total_price_cents   INTEGER     NOT NULL DEFAULT 0,
    total_duration_min  INTEGER     NOT NULL DEFAULT 0,
    notes               TEXT        NULL,
    confirmed_at        TIMESTAMPTZ NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_salon_bookings_status CHECK (
        status IN ('draft', 'awaiting_confirmation', 'confirmed', 'cancelled', 'failed')
    ),
    CONSTRAINT chk_salon_bookings_source CHECK (
        source IN ('voice', 'web', 'app')
    )
);

CREATE INDEX idx_salon_bookings_tenant_id     ON salon_bookings (tenant_id);
CREATE INDEX idx_salon_bookings_tenant_status ON salon_bookings (tenant_id, status);
CREATE INDEX idx_salon_bookings_stylist_id    ON salon_bookings (stylist_id) WHERE stylist_id IS NOT NULL;

ALTER TABLE salon_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_bookings FORCE ROW LEVEL SECURITY;

CREATE POLICY salon_bookings_tenant_isolation ON salon_bookings
    USING (tenant_id::text = current_setting('app.current_tenant', true));


-- ===========================================================================
-- TABLE: salon_booking_services  (junction: booking ↔ service snapshot)
-- Analogous to restaurant_order_items
-- ===========================================================================

CREATE TABLE salon_booking_services (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    booking_id       UUID        NOT NULL REFERENCES salon_bookings (id) ON DELETE CASCADE,
    service_id       UUID        NOT NULL,
    name_snapshot    TEXT        NOT NULL,
    duration_minutes INTEGER     NOT NULL,
    price_cents      INTEGER     NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_salon_booking_services_duration CHECK (duration_minutes > 0),
    CONSTRAINT chk_salon_booking_services_price    CHECK (price_cents >= 0)
);

CREATE INDEX idx_salon_booking_services_tenant_id  ON salon_booking_services (tenant_id);
CREATE INDEX idx_salon_booking_services_booking_id ON salon_booking_services (booking_id);

ALTER TABLE salon_booking_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_booking_services FORCE ROW LEVEL SECURITY;

CREATE POLICY salon_booking_services_tenant_isolation ON salon_booking_services
    USING (tenant_id::text = current_setting('app.current_tenant', true));


-- ===========================================================================
-- TABLE: voice_salon_contexts  (session state — analogous to voice_order_contexts)
-- ===========================================================================

CREATE TABLE voice_salon_contexts (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID        NOT NULL,
    voice_call_id        UUID        NOT NULL,
    voice_session_id     UUID        NOT NULL UNIQUE,
    status               TEXT        NOT NULL DEFAULT 'draft',
    booking_context_json JSONB       NOT NULL DEFAULT '{}',
    confirmed_at         TIMESTAMPTZ NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_voice_salon_contexts_status CHECK (
        status IN ('draft', 'awaiting_confirmation', 'confirmed', 'cancelled', 'failed')
    )
);

CREATE INDEX idx_voice_salon_contexts_tenant_id       ON voice_salon_contexts (tenant_id);
CREATE INDEX idx_voice_salon_contexts_voice_session_id ON voice_salon_contexts (voice_session_id);
CREATE INDEX idx_voice_salon_contexts_voice_call_id    ON voice_salon_contexts (voice_call_id);

ALTER TABLE voice_salon_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_salon_contexts FORCE ROW LEVEL SECURITY;

CREATE POLICY voice_salon_contexts_tenant_isolation ON voice_salon_contexts
    USING (tenant_id::text = current_setting('app.current_tenant', true));


-- ===========================================================================
-- TABLE: salon_settings  (tenant-level config — analogous to restaurant_settings)
-- ===========================================================================

CREATE TABLE salon_settings (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL UNIQUE,
    settings   JSONB       NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_salon_settings_tenant_id ON salon_settings (tenant_id);

ALTER TABLE salon_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY salon_settings_tenant_isolation ON salon_settings
    USING (tenant_id::text = current_setting('app.current_tenant', true));


-- ===========================================================================
-- Update existing check constraints to allow 'salon' track
-- ===========================================================================

-- voice_agents.track_scope
ALTER TABLE voice_agents
    DROP CONSTRAINT IF EXISTS chk_voice_agents_track_scope;

ALTER TABLE voice_agents
    ADD CONSTRAINT chk_voice_agents_track_scope
        CHECK (track_scope IS NULL OR track_scope IN ('booking', 'restaurant', 'salon', 'multi'));

-- voice_calls.track_type
ALTER TABLE voice_calls
    DROP CONSTRAINT IF EXISTS chk_voice_calls_track_type;

ALTER TABLE voice_calls
    ADD CONSTRAINT chk_voice_calls_track_type
        CHECK (track_type IS NULL OR track_type IN ('booking', 'restaurant', 'salon', 'unknown'));

-- voice_sessions.track_type
ALTER TABLE voice_sessions
    DROP CONSTRAINT IF EXISTS chk_voice_sessions_track_type;

ALTER TABLE voice_sessions
    ADD CONSTRAINT chk_voice_sessions_track_type
        CHECK (track_type IN ('booking', 'restaurant', 'salon'));

-- voice_tool_invocations.track_type
ALTER TABLE voice_tool_invocations
    DROP CONSTRAINT IF EXISTS chk_voice_tool_invocations_track_type;

ALTER TABLE voice_tool_invocations
    ADD CONSTRAINT chk_voice_tool_invocations_track_type
        CHECK (track_type IN ('booking', 'restaurant', 'salon'));
