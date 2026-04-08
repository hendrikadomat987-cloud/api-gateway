-- =============================================================================
-- Migration: 20260408000002_restaurant_settings.sql
-- Adds a per-tenant settings store for opening hours, ETA config, etc.
-- =============================================================================

CREATE TABLE restaurant_settings (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL UNIQUE,
    settings    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_restaurant_settings_tenant_id
    ON restaurant_settings (tenant_id);

-- ---------------------------------------------------------------------------
-- Seed: dev tenant 11111111-1111-1111-1111-111111111111
-- ---------------------------------------------------------------------------

INSERT INTO restaurant_settings (tenant_id, settings)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    '{
        "opening_hours": {
            "monday":    { "open": "11:00", "close": "22:00" },
            "tuesday":   { "open": "11:00", "close": "22:00" },
            "wednesday": { "open": "11:00", "close": "22:00" },
            "thursday":  { "open": "11:00", "close": "22:00" },
            "friday":    { "open": "11:00", "close": "23:00" },
            "saturday":  { "open": "11:00", "close": "23:00" },
            "sunday":    { "open": "12:00", "close": "21:00" }
        },
        "eta_pickup_min": 15,
        "eta_pickup_max": 20,
        "eta_delivery_min": 30,
        "eta_delivery_max": 45
    }'::jsonb
)
ON CONFLICT (tenant_id) DO NOTHING;
