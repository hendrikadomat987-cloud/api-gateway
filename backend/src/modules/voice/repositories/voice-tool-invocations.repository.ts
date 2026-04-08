// src/modules/voice/repositories/voice-tool-invocations.repository.ts
import type { VoiceToolInvocation } from '../../../types/voice.js';
import { withTenant } from '../../../lib/db.js';

export async function findToolInvocationById(
  tenantId: string,
  toolInvocationId: string,
): Promise<VoiceToolInvocation | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceToolInvocation>(
      `
      SELECT *
      FROM voice_tool_invocations
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, toolInvocationId],
    );

    return result.rows[0] ?? null;
  });
}

export async function listToolInvocationsBySessionId(
  tenantId: string,
  sessionId: string,
): Promise<VoiceToolInvocation[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceToolInvocation>(
      `
      SELECT *
      FROM voice_tool_invocations
      WHERE tenant_id = $1
        AND voice_session_id = $2
      ORDER BY created_at DESC
      `,
      [tenantId, sessionId],
    );

    return result.rows;
  });
}

export async function listToolInvocationsByVoiceCallId(
  tenantId: string,
  voiceCallId: string,
): Promise<VoiceToolInvocation[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceToolInvocation>(
      `
      SELECT *
      FROM voice_tool_invocations
      WHERE tenant_id = $1
        AND voice_call_id = $2
      ORDER BY created_at DESC
      `,
      [tenantId, voiceCallId],
    );

    return result.rows;
  });
}

export async function createToolInvocation(
  data: Omit<VoiceToolInvocation, 'id' | 'created_at' | 'updated_at'>,
): Promise<VoiceToolInvocation> {
  return withTenant(data.tenant_id, async (client) => {
    const result = await client.query<VoiceToolInvocation>(
      `
      INSERT INTO voice_tool_invocations (
        tenant_id,
        voice_call_id,
        voice_session_id,
        tool_name,
        track_type,
        request_payload_json,
        response_payload_json,
        status,
        error_code,
        started_at,
        finished_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
      RETURNING *
      `,
      [
        data.tenant_id,
        data.voice_call_id,
        data.voice_session_id,
        data.tool_name,
        data.track_type,
        data.request_payload_json ?? null,
        data.response_payload_json ?? null,
        data.status,
        data.error_code ?? null,
        data.started_at ?? null,
        data.finished_at ?? null,
      ],
    );

    return result.rows[0]!;
  });
}

export async function updateToolInvocation(
  tenantId: string,
  toolInvocationId: string,
  data: Partial<
    Pick<
      VoiceToolInvocation,
      | 'response_payload_json'
      | 'status'
      | 'error_code'
      | 'finished_at'
    >
  >,
): Promise<VoiceToolInvocation> {
  return withTenant(tenantId, async (client) => {
    const existing = await client.query<VoiceToolInvocation>(
      `
      SELECT *
      FROM voice_tool_invocations
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, toolInvocationId],
    );

    const current = existing.rows[0];
    if (!current) {
      throw new Error(`Voice tool invocation not found: ${toolInvocationId}`);
    }

    const result = await client.query<VoiceToolInvocation>(
      `
      UPDATE voice_tool_invocations
      SET
        response_payload_json = $3,
        status = $4,
        error_code = $5,
        finished_at = $6,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
      `,
      [
        tenantId,
        toolInvocationId,
        data.response_payload_json ?? current.response_payload_json ?? null,
        data.status ?? current.status,
        data.error_code ?? current.error_code ?? null,
        data.finished_at ?? current.finished_at ?? null,
      ],
    );

    return result.rows[0]!;
  });
}