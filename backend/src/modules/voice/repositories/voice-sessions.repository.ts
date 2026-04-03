// src/modules/voice/repositories/voice-sessions.repository.ts
import type { VoiceSession } from '../../../types/voice.js';
import { withTenant } from '../../../lib/db.js';

export async function findSessionByVoiceCallId(
  tenantId: string,
  voiceCallId: string,
): Promise<VoiceSession | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceSession>(
      `
      SELECT *
      FROM voice_sessions
      WHERE tenant_id = $1
        AND voice_call_id = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [tenantId, voiceCallId],
    );

    return result.rows[0] ?? null;
  });
}

export async function findSessionById(
  tenantId: string,
  sessionId: string,
): Promise<VoiceSession | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceSession>(
      `
      SELECT *
      FROM voice_sessions
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, sessionId],
    );

    return result.rows[0] ?? null;
  });
}

export async function listSessionsByTenantId(
  tenantId: string,
): Promise<VoiceSession[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceSession>(
      `
      SELECT *
      FROM voice_sessions
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      `,
      [tenantId],
    );

    return result.rows;
  });
}

export async function createSession(
  data: Omit<VoiceSession, 'id' | 'created_at' | 'updated_at'>,
): Promise<VoiceSession> {
  return withTenant(data.tenant_id, async (client) => {
    const result = await client.query<VoiceSession>(
      `
      INSERT INTO voice_sessions (
        tenant_id,
        voice_call_id,
        session_key,
        status,
        track_type,
        current_intent,
        current_step,
        context_json,
        last_user_message,
        last_assistant_message,
        started_at,
        ended_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      RETURNING *
      `,
      [
        data.tenant_id,
        data.voice_call_id,
        data.session_key ?? null,
        data.status,
        data.track_type,
        data.current_intent ?? null,
        data.current_step ?? null,
        data.context_json,
        data.last_user_message ?? null,
        data.last_assistant_message ?? null,
        data.started_at ?? null,
        data.ended_at ?? null,
      ],
    );

    return result.rows[0]!;
  });
}

export async function updateSession(
  tenantId: string,
  sessionId: string,
  data: Partial<
    Pick<
      VoiceSession,
      | 'status'
      | 'track_type'
      | 'context_json'
      | 'current_intent'
      | 'current_step'
      | 'last_user_message'
      | 'last_assistant_message'
      | 'ended_at'
    >
  >,
): Promise<VoiceSession> {
  return withTenant(tenantId, async (client) => {
    const existing = await client.query<VoiceSession>(
      `
      SELECT *
      FROM voice_sessions
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, sessionId],
    );

    const current = existing.rows[0];
    if (!current) {
      throw new Error(`Voice session not found: ${sessionId}`);
    }

    const result = await client.query<VoiceSession>(
      `
      UPDATE voice_sessions
      SET
        status = $3,
        track_type = $4,
        context_json = $5,
        current_intent = $6,
        current_step = $7,
        last_user_message = $8,
        last_assistant_message = $9,
        ended_at = $10,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
      `,
      [
        tenantId,
        sessionId,
        data.status ?? current.status,
        data.track_type ?? current.track_type,
        data.context_json ?? current.context_json,
        data.current_intent ?? current.current_intent ?? null,
        data.current_step ?? current.current_step ?? null,
        data.last_user_message ?? current.last_user_message ?? null,
        data.last_assistant_message ?? current.last_assistant_message ?? null,
        data.ended_at ?? current.ended_at ?? null,
      ],
    );

    return result.rows[0]!;
  });
}