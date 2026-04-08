-- =============================================================================
-- Migration: 20260408000001_restaurant_orders_delivery.sql
-- Adds delivery/pickup fields to restaurant_orders and creates the
-- delivery-zone catalog for Phase 3 Order Total + Delivery Rules.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Extend restaurant_orders with delivery fields
-- ---------------------------------------------------------------------------

ALTER TABLE restaurant_orders
    ADD COLUMN delivery_type       TEXT    NOT NULL DEFAULT 'pickup',
    ADD COLUMN subtotal_cents      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN delivery_fee_cents  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN customer_postal_code TEXT   NULL,
    ADD COLUMN customer_name        TEXT   NULL;

ALTER TABLE restaurant_orders
    ADD CONSTRAINT chk_restaurant_orders_delivery_type
        CHECK (delivery_type IN ('pickup', 'delivery'));


-- ===========================================================================
-- TABLE: restaurant_delivery_zones
-- Per-tenant PLZ → delivery fee + minimum order rules
-- ===========================================================================

CREATE TABLE restaurant_delivery_zones (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    postal_code       TEXT        NOT NULL,
    zone_name         TEXT        NOT NULL,
    delivery_fee_cents INTEGER    NOT NULL,
    min_order_cents   INTEGER     NOT NULL DEFAULT 1500,
    is_active         BOOLEAN     NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_restaurant_delivery_zones_tenant_postal
        UNIQUE (tenant_id, postal_code)
);

CREATE INDEX idx_restaurant_delivery_zones_tenant_id
    ON restaurant_delivery_zones (tenant_id);


-- ---------------------------------------------------------------------------
-- Seed: dev tenant 11111111-1111-1111-1111-111111111111
-- ---------------------------------------------------------------------------

INSERT INTO restaurant_delivery_zones
    (tenant_id, postal_code, zone_name, delivery_fee_cents, min_order_cents)
VALUES
    ('11111111-1111-1111-1111-111111111111', '50667', 'Zone A', 250, 1500),
    ('11111111-1111-1111-1111-111111111111', '50668', 'Zone A', 250, 1500),
    ('11111111-1111-1111-1111-111111111111', '50670', 'Zone B', 350, 1500),
    ('11111111-1111-1111-1111-111111111111', '50672', 'Zone B', 350, 1500),
    ('11111111-1111-1111-1111-111111111111', '50674', 'Zone B', 350, 1500);
