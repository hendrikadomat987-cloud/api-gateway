-- =============================================================================
-- Migration: 20260409000000_feature_system_v1.sql
-- Feature System V1 — global catalogue + tenant provisioning
--
-- Tables:
--   domains            — global catalogue (no RLS; admin-managed)
--   features           — global catalogue (no RLS; admin-managed)
--   domain_features    — many-to-many, global (no RLS)
--   tenant_domains     — tenant scoped (RLS via app.current_tenant)
--   tenant_features    — tenant scoped (RLS via app.current_tenant)
--
-- Design decisions:
--   • domains/features/domain_features are global read-only catalogues.
--     No RLS needed — every tenant reads the same catalogue.
--   • tenant_domains and tenant_features are tenant-owned rows, protected
--     by the same FORCE ROW LEVEL SECURITY pattern as all other tables.
--   • voice.core is automatically provisioned alongside ANY domain because
--     every voice-capable tenant needs it. It is listed under the 'voice'
--     domain in domain_features so provisioning the 'voice' domain also
--     gives voice.core and voice.callback.
-- =============================================================================


-- ===========================================================================
-- TABLE: domains  (global catalogue)
-- ===========================================================================

CREATE TABLE domains (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_key  TEXT        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    description TEXT        NULL,
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_domains_domain_key  ON domains (domain_key);
CREATE INDEX idx_domains_is_active   ON domains (is_active) WHERE is_active = true;


-- ===========================================================================
-- TABLE: features  (global catalogue)
-- ===========================================================================

CREATE TABLE features (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_key TEXT        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    description TEXT        NULL,
    category    TEXT        NOT NULL DEFAULT 'core',
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_features_category
        CHECK (category IN ('core', 'addon', 'premium'))
);

CREATE INDEX idx_features_feature_key ON features (feature_key);
CREATE INDEX idx_features_is_active   ON features (is_active) WHERE is_active = true;


-- ===========================================================================
-- TABLE: domain_features  (global many-to-many: domain ↔ feature)
-- ===========================================================================

CREATE TABLE domain_features (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id  UUID        NOT NULL REFERENCES domains  (id) ON DELETE CASCADE,
    feature_id UUID        NOT NULL REFERENCES features (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_domain_features UNIQUE (domain_id, feature_id)
);

CREATE INDEX idx_domain_features_domain_id  ON domain_features (domain_id);
CREATE INDEX idx_domain_features_feature_id ON domain_features (feature_id);


-- ===========================================================================
-- TABLE: tenant_domains  (which domains a tenant has activated)
-- ===========================================================================

CREATE TABLE tenant_domains (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL,
    domain_id  UUID        NOT NULL REFERENCES domains (id) ON DELETE RESTRICT,
    is_enabled BOOLEAN     NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_tenant_domains UNIQUE (tenant_id, domain_id)
);

CREATE INDEX idx_tenant_domains_tenant_id  ON tenant_domains (tenant_id);
CREATE INDEX idx_tenant_domains_domain_id  ON tenant_domains (domain_id);
CREATE INDEX idx_tenant_domains_enabled    ON tenant_domains (tenant_id, is_enabled)
    WHERE is_enabled = true;

ALTER TABLE tenant_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_domains FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_domains_tenant_isolation ON tenant_domains
    USING      (tenant_id::text = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));


-- ===========================================================================
-- TABLE: tenant_features  (which features a tenant has, with provenance)
-- ===========================================================================

CREATE TABLE tenant_features (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL,
    feature_id UUID        NOT NULL REFERENCES features (id) ON DELETE RESTRICT,
    is_enabled BOOLEAN     NOT NULL DEFAULT true,
    source     TEXT        NOT NULL DEFAULT 'domain_provisioned',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_tenant_features UNIQUE (tenant_id, feature_id),
    CONSTRAINT chk_tenant_features_source
        CHECK (source IN ('domain_provisioned', 'manual_override'))
);

CREATE INDEX idx_tenant_features_tenant_id  ON tenant_features (tenant_id);
CREATE INDEX idx_tenant_features_feature_id ON tenant_features (feature_id);
CREATE INDEX idx_tenant_features_enabled    ON tenant_features (tenant_id, is_enabled)
    WHERE is_enabled = true;
CREATE INDEX idx_tenant_features_lookup     ON tenant_features (tenant_id, feature_id, is_enabled);

ALTER TABLE tenant_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_features FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_features_tenant_isolation ON tenant_features
    USING      (tenant_id::text = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));


-- ===========================================================================
-- SEED: Global domain catalogue (V1)
-- ===========================================================================

INSERT INTO domains (domain_key, name, description) VALUES
    ('voice',      'Voice',      'Core voice infrastructure — required for all voice-enabled tenants'),
    ('booking',    'Booking',    'Appointment / availability booking domain'),
    ('restaurant', 'Restaurant', 'Restaurant menu, ordering and delivery domain'),
    ('salon',      'Salon',      'Hair salon / beauty studio booking and services domain')
ON CONFLICT (domain_key) DO NOTHING;


-- ===========================================================================
-- SEED: Global feature catalogue (V1)
-- ===========================================================================

INSERT INTO features (feature_key, name, description, category) VALUES
    -- Voice domain
    ('voice.core',              'Voice Core',               'Base voice call handling and session management',   'core'),
    ('voice.callback',          'Voice Callback',           'Callback request creation and forwarding',         'core'),
    -- Booking domain
    ('booking.core',            'Booking Core',             'Appointment creation and confirmation',             'core'),
    ('booking.availability',    'Booking Availability',     'Availability check and next-free-slot queries',     'core'),
    ('booking.faq',             'Booking FAQ',              'FAQ and knowledge-base answers for bookings',       'addon'),
    -- Restaurant domain
    ('restaurant.core',         'Restaurant Core',          'Restaurant base — knowledge and Q&A',               'core'),
    ('restaurant.menu',         'Restaurant Menu',          'Menu browsing and item search',                     'core'),
    ('restaurant.ordering',     'Restaurant Ordering',      'Order creation, modification and confirmation',     'core'),
    ('restaurant.delivery',     'Restaurant Delivery',      'Delivery zone lookup and delivery routing',         'addon'),
    -- Salon domain
    ('salon.core',              'Salon Core',               'Salon service catalogue browsing and FAQ',          'core'),
    ('salon.booking',           'Salon Booking',            'Salon appointment creation and confirmation',       'core'),
    ('salon.availability',      'Salon Availability',       'Stylist and slot availability queries',             'addon')
ON CONFLICT (feature_key) DO NOTHING;


-- ===========================================================================
-- SEED: domain_features (which features belong to which domain)
-- ===========================================================================

-- Use sub-selects so this is key-safe and order-independent
INSERT INTO domain_features (domain_id, feature_id)
SELECT d.id, f.id FROM domains d, features f
WHERE (d.domain_key, f.feature_key) IN (
    -- voice domain features
    ('voice', 'voice.core'),
    ('voice', 'voice.callback'),
    -- booking domain features
    ('booking', 'booking.core'),
    ('booking', 'booking.availability'),
    ('booking', 'booking.faq'),
    -- restaurant domain features
    ('restaurant', 'restaurant.core'),
    ('restaurant', 'restaurant.menu'),
    ('restaurant', 'restaurant.ordering'),
    ('restaurant', 'restaurant.delivery'),
    -- salon domain features
    ('salon', 'salon.core'),
    ('salon', 'salon.booking'),
    ('salon', 'salon.availability')
)
ON CONFLICT (domain_id, feature_id) DO NOTHING;


-- ===========================================================================
-- SEED: Provision known test tenants
--
-- These are the deterministic UUIDs seeded by the test infrastructure.
-- Runs as superuser (migration context) — bypasses FORCE RLS intentionally.
-- Production tenants are provisioned via the backend provisionTenantDomain()
-- function, which uses withTenant() and runs under normal RLS.
--
-- Tenant A / Restaurant (11111111-…-1111): booking + restaurant + voice
-- Tenant B / Generic   (22222222-…-2222): voice only
-- Morgenlicht Salon    (00000000-…-0002): salon + voice
-- Studio Nord Salon    (00000000-…-0003): salon + voice
-- ===========================================================================

DO $$
DECLARE
    -- Domain IDs
    d_voice      UUID;
    d_booking    UUID;
    d_restaurant UUID;
    d_salon      UUID;

    -- Known test tenant IDs
    t_a          UUID := '11111111-1111-1111-1111-111111111111';
    t_b          UUID := '22222222-2222-2222-2222-222222222222';
    t_salon      UUID := '00000000-0000-0000-0000-000000000002';
    t_salon2     UUID := '00000000-0000-0000-0000-000000000003';

    r            RECORD;
BEGIN
    SELECT id INTO d_voice      FROM domains WHERE domain_key = 'voice';
    SELECT id INTO d_booking    FROM domains WHERE domain_key = 'booking';
    SELECT id INTO d_restaurant FROM domains WHERE domain_key = 'restaurant';
    SELECT id INTO d_salon      FROM domains WHERE domain_key = 'salon';

    -- ── Tenant A: voice + booking + restaurant ──────────────────────────────
    INSERT INTO tenant_domains (tenant_id, domain_id, is_enabled)
    VALUES (t_a, d_voice,      true),
           (t_a, d_booking,    true),
           (t_a, d_restaurant, true)
    ON CONFLICT (tenant_id, domain_id) DO NOTHING;

    FOR r IN
        SELECT df.feature_id FROM domain_features df
        WHERE df.domain_id IN (d_voice, d_booking, d_restaurant)
    LOOP
        INSERT INTO tenant_features (tenant_id, feature_id, is_enabled, source)
        VALUES (t_a, r.feature_id, true, 'domain_provisioned')
        ON CONFLICT (tenant_id, feature_id) DO NOTHING;
    END LOOP;

    -- ── Tenant B: voice only ────────────────────────────────────────────────
    INSERT INTO tenant_domains (tenant_id, domain_id, is_enabled)
    VALUES (t_b, d_voice, true)
    ON CONFLICT (tenant_id, domain_id) DO NOTHING;

    FOR r IN
        SELECT df.feature_id FROM domain_features df
        WHERE df.domain_id = d_voice
    LOOP
        INSERT INTO tenant_features (tenant_id, feature_id, is_enabled, source)
        VALUES (t_b, r.feature_id, true, 'domain_provisioned')
        ON CONFLICT (tenant_id, feature_id) DO NOTHING;
    END LOOP;

    -- ── Morgenlicht salon: voice + salon ────────────────────────────────────
    INSERT INTO tenant_domains (tenant_id, domain_id, is_enabled)
    VALUES (t_salon, d_voice, true),
           (t_salon, d_salon, true)
    ON CONFLICT (tenant_id, domain_id) DO NOTHING;

    FOR r IN
        SELECT df.feature_id FROM domain_features df
        WHERE df.domain_id IN (d_voice, d_salon)
    LOOP
        INSERT INTO tenant_features (tenant_id, feature_id, is_enabled, source)
        VALUES (t_salon, r.feature_id, true, 'domain_provisioned')
        ON CONFLICT (tenant_id, feature_id) DO NOTHING;
    END LOOP;

    -- ── Studio Nord salon: voice + salon ────────────────────────────────────
    INSERT INTO tenant_domains (tenant_id, domain_id, is_enabled)
    VALUES (t_salon2, d_voice, true),
           (t_salon2, d_salon, true)
    ON CONFLICT (tenant_id, domain_id) DO NOTHING;

    FOR r IN
        SELECT df.feature_id FROM domain_features df
        WHERE df.domain_id IN (d_voice, d_salon)
    LOOP
        INSERT INTO tenant_features (tenant_id, feature_id, is_enabled, source)
        VALUES (t_salon2, r.feature_id, true, 'domain_provisioned')
        ON CONFLICT (tenant_id, feature_id) DO NOTHING;
    END LOOP;

END $$;
