-- =============================================================================
-- Migration: 20260408000006_voice_callback_requests_salon_track.sql
-- Extend voice_callback_requests.track_type constraint to include 'salon'.
--
-- Staging state before: CHECK (track_type IN ('booking', 'restaurant'))
-- Staging state after:  CHECK (track_type IN ('booking', 'restaurant', 'salon'))
--
-- Safe to run while table is live — no data modification, only constraint change.
-- Existing rows are unaffected (all existing track_type values remain valid).
-- =============================================================================

ALTER TABLE voice_callback_requests
    DROP CONSTRAINT chk_voice_callback_requests_track_type;

ALTER TABLE voice_callback_requests
    ADD CONSTRAINT chk_voice_callback_requests_track_type
        CHECK (track_type IN ('booking', 'restaurant', 'salon'));
