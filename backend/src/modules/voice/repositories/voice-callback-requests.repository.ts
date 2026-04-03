// src/modules/voice/repositories/voice-callback-requests.repository.ts
import type { VoiceCallbackRequest } from '../../../types/voice.js';
import { withTenant } from '../../../lib/db.js';

export async function createCallbackRequest(
  data: Omit<VoiceCallbackRequest, 'id' | 'created_at' | 'updated_at'>,
): Promise<VoiceCallbackRequest> {
  return withTenant(data.tenant_id, async (client) => {
    const result = await client.query<VoiceCallbackRequest>(
      `
      INSERT INTO voice_callback_requests (
        tenant_id,
        voice_call_id,
        voice_session_id,
        track_type,
        caller_number,
        preferred_time,
        notes,
        status,
        n8n_workflow_id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      )
      RETURNING *
      `,
      [
        data.tenant_id,
        data.voice_call_id,
        data.voice_session_id,
        data.track_type,
        data.caller_number,
        data.preferred_time ?? null,
        data.notes ?? null,
        data.status,
        data.n8n_workflow_id ?? null,
      ],
    );

    return result.rows[0]!;
  });
}

export async function findCallbackRequestById(
  tenantId: string,
  id: string,
): Promise<VoiceCallbackRequest | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceCallbackRequest>(
      `
      SELECT *
      FROM voice_callback_requests
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, id],
    );

    return result.rows[0] ?? null;
  });
}
