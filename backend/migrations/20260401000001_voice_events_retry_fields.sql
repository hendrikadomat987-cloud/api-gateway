-- =============================================================================
-- Migration: 20260401000001_voice_events_retry_fields.sql
-- Voice V1 — add retry tracking fields and dead_letter status to voice_events
-- =============================================================================

-- Add retry tracking columns
ALTER TABLE voice_events
    ADD COLUMN retry_count   INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN last_retry_at TIMESTAMPTZ NULL;

-- Drop the existing check constraint and re-create it with dead_letter included
ALTER TABLE voice_events
    DROP CONSTRAINT chk_voice_events_processing_status;

ALTER TABLE voice_events
    ADD CONSTRAINT chk_voice_events_processing_status
        CHECK (processing_status IN ('received', 'normalized', 'processed',
                                     'failed', 'ignored', 'dead_letter'));

-- Index to support the worker's dead-letter monitoring query
CREATE INDEX idx_voice_events_retry_count
    ON voice_events (tenant_id, retry_count)
    WHERE processing_status = 'failed';
