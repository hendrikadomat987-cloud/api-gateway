import type { VoiceEvent, VoiceEventProcessingStatus } from '../../../types/voice.js';
import { withTenant } from '../../../lib/db.js';

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
  data: Omit<VoiceEvent, 'id' | 'created_at'>,
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