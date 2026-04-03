import type { VoiceCall } from '../../../types/voice.js';
import { withTenant } from '../../../lib/db.js';

export async function findCallByProviderCallId(
  tenantId: string,
  providerCallId: string,
): Promise<VoiceCall | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceCall>(
      `
      SELECT *
      FROM voice_calls
      WHERE tenant_id = $1
        AND provider_call_id = $2
      LIMIT 1
      `,
      [tenantId, providerCallId],
    );

    return result.rows[0] ?? null;
  });
}

export async function findCallById(
  tenantId: string,
  callId: string,
): Promise<VoiceCall | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceCall>(
      `
      SELECT *
      FROM voice_calls
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, callId],
    );

    return result.rows[0] ?? null;
  });
}

export async function listCallsByTenantId(
  tenantId: string,
): Promise<VoiceCall[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceCall>(
      `
      SELECT *
      FROM voice_calls
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      `,
      [tenantId],
    );

    return result.rows;
  });
}

export async function createCall(
  data: Omit<VoiceCall, 'id' | 'created_at' | 'updated_at'>,
): Promise<VoiceCall> {
  return withTenant(data.tenant_id, async (client) => {
    const result = await client.query<VoiceCall>(
      `
      INSERT INTO voice_calls (
        tenant_id,
        voice_provider_id,
        voice_agent_id,
        voice_number_id,
        provider_call_id,
        direction,
        caller_number,
        callee_number,
        status,
        track_type,
        started_at,
        ended_at,
        duration_seconds,
        summary,
        fallback_reason,
        handover_reason
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16
      )
      RETURNING *
      `,
      [
        data.tenant_id,
        data.voice_provider_id,
        data.voice_agent_id ?? null,
        data.voice_number_id ?? null,
        data.provider_call_id,
        data.direction,
        data.caller_number ?? null,
        data.callee_number ?? null,
        data.status,
        data.track_type ?? null,
        data.started_at ?? null,
        data.ended_at ?? null,
        data.duration_seconds ?? null,
        data.summary ?? null,
        data.fallback_reason ?? null,
        data.handover_reason ?? null,
      ],
    );

    return result.rows[0]!;
  });
}

export async function updateCall(
  tenantId: string,
  callId: string,
  data: Partial<
    Pick<
      VoiceCall,
      | 'status'
      | 'ended_at'
      | 'duration_seconds'
      | 'summary'
      | 'fallback_reason'
      | 'handover_reason'
    >
  >,
): Promise<VoiceCall> {
  return withTenant(tenantId, async (client) => {
    const existing = await client.query<VoiceCall>(
      `
      SELECT *
      FROM voice_calls
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, callId],
    );

    const current = existing.rows[0];
    if (!current) {
      throw new Error(`Voice call not found: ${callId}`);
    }

    const result = await client.query<VoiceCall>(
      `
      UPDATE voice_calls
      SET
        status = $3,
        ended_at = $4,
        duration_seconds = $5,
        summary = $6,
        fallback_reason = $7,
        handover_reason = $8,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
      `,
      [
        tenantId,
        callId,
        data.status ?? current.status,
        data.ended_at ?? current.ended_at ?? null,
        data.duration_seconds ?? current.duration_seconds ?? null,
        data.summary ?? current.summary ?? null,
        data.fallback_reason ?? current.fallback_reason ?? null,
        data.handover_reason ?? current.handover_reason ?? null,
      ],
    );

    return result.rows[0]!;
  });
}