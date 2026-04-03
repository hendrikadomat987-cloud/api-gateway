import type { VoiceEvent, VoiceEventProcessingStatus } from '../../../types/voice.js';
import { pool, withTenant } from '../../../lib/db.js';

export async function findEventById(
  tenantId: string,
  eventId: string,
): Promise<VoiceEvent | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceEvent>(
      `
      SELECT *
      FROM voice_events
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, eventId],
    );

    return result.rows[0] ?? null;
  });
}

/**
 * Returns distinct tenant IDs that currently have at least one failed event.
 *
 * This is an administrative query for the internal retry worker. It uses
 * the database connection's default role without a per-tenant RLS context.
 * Only tenant IDs (not event data) are returned here; all actual event access
 * is performed per-tenant via withTenant() in listFailedEvents() and
 * replayFailedEvent().
 *
 * Must only be called from trusted background processes, never from request handlers.
 */
export async function listDistinctTenantsWithFailedEvents(): Promise<string[]> {
  const result = await pool.query<{ tenant_id: string }>(
    `
    SELECT DISTINCT tenant_id
    FROM voice_events
    WHERE processing_status = 'failed'
    `,
  );

  return result.rows.map((r) => r.tenant_id);
}

export async function listFailedEvents(
  tenantId: string,
  limit?: number,
): Promise<VoiceEvent[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceEvent>(
      `
      SELECT *
      FROM voice_events
      WHERE tenant_id = $1
        AND processing_status = 'failed'
      ORDER BY created_at ASC
      ${limit !== undefined ? `LIMIT ${limit}` : ''}
      `,
      [tenantId],
    );

    return result.rows;
  });
}

export async function findEventByProviderEventId(
  tenantId: string,
  voiceProviderId: string,
  providerEventId: string,
): Promise<VoiceEvent | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceEvent>(
      `
      SELECT *
      FROM voice_events
      WHERE tenant_id = $1
        AND voice_provider_id = $2
        AND provider_event_id = $3
      LIMIT 1
      `,
      [tenantId, voiceProviderId, providerEventId],
    );

    return result.rows[0] ?? null;
  });
}

export async function listEventsByVoiceCallId(
  tenantId: string,
  voiceCallId: string,
): Promise<VoiceEvent[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceEvent>(
      `
      SELECT *
      FROM voice_events
      WHERE tenant_id = $1
        AND voice_call_id = $2
      ORDER BY created_at ASC
      `,
      [tenantId, voiceCallId],
    );

    return result.rows;
  });
}

export async function createEvent(
  data: Omit<VoiceEvent, 'id' | 'created_at' | 'retry_count' | 'last_retry_at'>,
): Promise<VoiceEvent> {
  return withTenant(data.tenant_id, async (client) => {
    const result = await client.query<VoiceEvent>(
      `
      INSERT INTO voice_events (
        tenant_id,
        voice_call_id,
        voice_session_id,
        voice_provider_id,
        provider_event_id,
        event_type,
        event_ts,
        raw_payload_json,
        normalized_payload_json,
        processing_status,
        processing_error_code,
        processing_error_message
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12
      )
      RETURNING *
      `,
      [
        data.tenant_id,
        data.voice_call_id ?? null,
        data.voice_session_id ?? null,
        data.voice_provider_id,
        data.provider_event_id ?? null,
        data.event_type,
        data.event_ts ?? null,
        data.raw_payload_json,
        data.normalized_payload_json ?? null,
        data.processing_status,
        data.processing_error_code ?? null,
        data.processing_error_message ?? null,
      ],
    );

    return result.rows[0]!;
  });
}

export async function updateEventStatus(
  tenantId: string,
  eventId: string,
  status: VoiceEventProcessingStatus,
  errorMessage?: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `
      UPDATE voice_events
      SET
        processing_status        = $3,
        processing_error_message = $4
      WHERE tenant_id = $1
        AND id = $2
      `,
      [tenantId, eventId, status, errorMessage ?? null],
    );
  });
}

/**
 * Atomically increment retry_count and record the retry timestamp.
 * Called by the worker immediately before each replay attempt.
 */
export async function incrementRetryCount(
  tenantId: string,
  eventId: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `
      UPDATE voice_events
      SET
        retry_count   = retry_count + 1,
        last_retry_at = now()
      WHERE tenant_id = $1
        AND id = $2
      `,
      [tenantId, eventId],
    );
  });
}

/**
 * Move an event to the dead_letter terminal state.
 * Called by the worker when retry_count has reached the configured maximum.
 */
export async function markEventDeadLetter(
  tenantId: string,
  eventId: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `
      UPDATE voice_events
      SET
        processing_status        = 'dead_letter',
        processing_error_code    = 'MAX_RETRIES_EXCEEDED',
        processing_error_message = 'Maximum automatic retry attempts reached'
      WHERE tenant_id = $1
        AND id = $2
      `,
      [tenantId, eventId],
    );
  });
}

/**
 * Reset retry state so a dead_letter event gets a fresh set of auto-retries
 * after a successful manual replay.
 * Called by replayFailedEvent when the source event was in dead_letter state.
 */
export async function resetRetryCount(
  tenantId: string,
  eventId: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `
      UPDATE voice_events
      SET
        retry_count              = 0,
        last_retry_at            = NULL,
        processing_error_code    = NULL,
        processing_error_message = NULL
      WHERE tenant_id = $1
        AND id = $2
      `,
      [tenantId, eventId],
    );
  });
}