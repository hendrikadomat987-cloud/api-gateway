-- =============================================================================
-- Migration: 20260408000000_restaurant_order_items_modifiers.sql
-- Adds modifier storage and name snapshot to restaurant_order_items.
-- Enables Order Persistence Phase 2 — voice orders with structured modifiers.
-- =============================================================================

ALTER TABLE restaurant_order_items
    ADD COLUMN modifiers_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN name_snapshot   TEXT;
