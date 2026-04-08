-- =============================================================================
-- Migration: 20260408000005_salon_schedule.sql
-- Salon scheduling support tables:
--   1. salon_stylist_working_hours — per-stylist weekly schedule
--   2. salon_stylist_services      — stylist↔service capability mapping
--
-- Phase 2 foundation: consumed by the availability engine.
-- Not yet enforced by voice tools (Phase 1 treats stylist preference as soft).
-- =============================================================================


-- ===========================================================================
-- TABLE: salon_stylist_working_hours
-- Per-stylist weekly schedule: which days and hours each stylist works.
--
-- day_of_week follows the PostgreSQL DOW convention:
--   0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday,
--   4 = Thursday, 5 = Friday, 6 = Saturday
-- (matches EXTRACT(DOW FROM date) and JS Date.getDay())
-- ===========================================================================

CREATE TABLE salon_stylist_working_hours (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    stylist_id  UUID        NOT NULL REFERENCES salon_stylists(id) ON DELETE CASCADE,
    day_of_week INTEGER     NOT NULL,
    open_time   TIME        NOT NULL,
    close_time  TIME        NOT NULL,
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_salon_stylist_working_hours_day   CHECK (day_of_week BETWEEN 0 AND 6),
    CONSTRAINT chk_salon_stylist_working_hours_times CHECK (close_time > open_time),
    CONSTRAINT uq_salon_stylist_working_hours        UNIQUE (tenant_id, stylist_id, day_of_week)
);

CREATE INDEX idx_salon_stylist_working_hours_tenant_id  ON salon_stylist_working_hours (tenant_id);
CREATE INDEX idx_salon_stylist_working_hours_stylist_id ON salon_stylist_working_hours (stylist_id);
CREATE INDEX idx_salon_stylist_working_hours_day        ON salon_stylist_working_hours (tenant_id, day_of_week);

ALTER TABLE salon_stylist_working_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_stylist_working_hours FORCE ROW LEVEL SECURITY;

CREATE POLICY salon_stylist_working_hours_tenant_isolation ON salon_stylist_working_hours
    USING (tenant_id::text = current_setting('app.current_tenant', true));


-- ===========================================================================
-- TABLE: salon_stylist_services
-- Maps which services each stylist is capable of performing.
-- Informational in Phase 1 (not enforced at booking time).
-- Used by the availability engine in Phase 2.
-- ===========================================================================

CREATE TABLE salon_stylist_services (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    stylist_id  UUID        NOT NULL REFERENCES salon_stylists(id) ON DELETE CASCADE,
    service_id  UUID        NOT NULL REFERENCES salon_services(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_salon_stylist_services UNIQUE (tenant_id, stylist_id, service_id)
);

CREATE INDEX idx_salon_stylist_services_tenant_id  ON salon_stylist_services (tenant_id);
CREATE INDEX idx_salon_stylist_services_stylist_id ON salon_stylist_services (stylist_id);
CREATE INDEX idx_salon_stylist_services_service_id ON salon_stylist_services (service_id);

ALTER TABLE salon_stylist_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_stylist_services FORCE ROW LEVEL SECURITY;

CREATE POLICY salon_stylist_services_tenant_isolation ON salon_stylist_services
    USING (tenant_id::text = current_setting('app.current_tenant', true));
