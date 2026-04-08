-- =============================================================================
-- Migration: 20260408000004_salon_bookings_stylist_soft_ref.sql
--
-- Drops the FK constraint on salon_bookings.stylist_id.
--
-- Rationale:
--   A voice booking captures a *preference* for a stylist, not a hard reference.
--   The stylist may be referenced by name or ID during the call but not validated
--   against the stylists table at booking time. Enforcing a FK here would cause
--   spurious errors when:
--     - A non-existent stylist UUID is passed (e.g. a spoken name that resolves
--       to a placeholder)
--     - A stylist is deactivated after the booking was confirmed
--   Stylist validation should happen at a higher level (calendar/scheduling layer)
--   in a future phase, not at the DB constraint level.
-- =============================================================================

ALTER TABLE salon_bookings
    DROP CONSTRAINT IF EXISTS salon_bookings_stylist_id_fkey;
