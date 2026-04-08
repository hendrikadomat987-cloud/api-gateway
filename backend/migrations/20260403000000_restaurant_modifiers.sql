-- =============================================================================
-- Migration: 20260403000000_restaurant_modifiers.sql
-- Restaurant modifier catalog — per-tenant list of allowed modifiers
-- Multi-tenant: tenant isolation via current_setting('app.current_tenant', true)
-- =============================================================================


-- ===========================================================================
-- TABLE: restaurant_menu_modifiers
-- ===========================================================================

CREATE TABLE restaurant_menu_modifiers (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    name        TEXT        NOT NULL,
    type        TEXT        NOT NULL,
    price_cents INTEGER     NOT NULL DEFAULT 0,
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_restaurant_menu_modifiers_type
        CHECK (type IN ('add', 'remove', 'free_text'))
);

-- Unique constraint: one entry per modifier name+type per tenant
ALTER TABLE restaurant_menu_modifiers
    ADD CONSTRAINT uq_restaurant_menu_modifiers_tenant_name_type
        UNIQUE (tenant_id, name, type);

-- Indexes
CREATE INDEX idx_restaurant_menu_modifiers_tenant_id
    ON restaurant_menu_modifiers (tenant_id);

CREATE INDEX idx_restaurant_menu_modifiers_tenant_type
    ON restaurant_menu_modifiers (tenant_id, type);


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE restaurant_menu_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_menu_modifiers FORCE ROW LEVEL SECURITY;

CREATE POLICY restaurant_menu_modifiers_tenant_isolation
    ON restaurant_menu_modifiers
    USING (tenant_id::text = current_setting('app.current_tenant', true));


-- ---------------------------------------------------------------------------
-- Seed: dev tenant 11111111-1111-1111-1111-111111111111
-- ---------------------------------------------------------------------------

INSERT INTO restaurant_menu_modifiers (tenant_id, name, type, price_cents)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'extra Käse',     'add',       150),
    ('11111111-1111-1111-1111-111111111111', 'Champignons',    'add',       120),
    ('11111111-1111-1111-1111-111111111111', 'Jalapeños',      'add',       100),
    ('11111111-1111-1111-1111-111111111111', 'Zwiebeln',       'remove',      0),
    ('11111111-1111-1111-1111-111111111111', 'Käse',           'remove',      0),
    ('11111111-1111-1111-1111-111111111111', 'Knoblauch',      'remove',      0),
    ('11111111-1111-1111-1111-111111111111', 'extra knusprig', 'free_text',   0),
    ('11111111-1111-1111-1111-111111111111', 'Sauce separat',  'free_text',   0),
    ('11111111-1111-1111-1111-111111111111', 'bitte halbieren','free_text',   0);
