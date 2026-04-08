// src/modules/voice/repositories/voice-order-contexts.repository.ts
import { withTenant } from '../../../lib/db.js';
import type { VoiceOrderContext } from '../../../types/voice.js';

/**
 * Finds the voice_order_contexts row for a given session.
 * Returns null when no row exists yet.
 */
export async function findOrderContextBySessionId(
  tenantId: string,
  voiceSessionId: string,
): Promise<VoiceOrderContext | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceOrderContext>(
      `SELECT * FROM voice_order_contexts WHERE voice_session_id = $1 LIMIT 1`,
      [voiceSessionId],
    );
    return result.rows[0] ?? null;
  });
}

/**
 * Inserts or updates the voice_order_contexts row for a session.
 * On conflict (same voice_session_id), updates order_context_json and updated_at only.
 * Returns the full row after upsert.
 */
export async function upsertOrderContext(
  tenantId: string,
  voiceCallId: string,
  voiceSessionId: string,
  orderContextJson: Record<string, unknown>,
): Promise<VoiceOrderContext> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceOrderContext>(
      `INSERT INTO voice_order_contexts
         (tenant_id, voice_call_id, voice_session_id, status, order_context_json)
       VALUES ($1, $2, $3, 'draft', $4)
       ON CONFLICT (voice_session_id)
       DO UPDATE SET
         order_context_json = EXCLUDED.order_context_json,
         updated_at         = now()
       RETURNING *`,
      [tenantId, voiceCallId, voiceSessionId, JSON.stringify(orderContextJson)],
    );
    return result.rows[0];
  });
}

/**
 * Sets the voice_order_contexts row to 'confirmed' and stamps confirmed_at.
 */
export async function confirmOrderContext(
  tenantId: string,
  voiceSessionId: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE voice_order_contexts
       SET status       = 'confirmed',
           confirmed_at = now(),
           updated_at   = now()
       WHERE voice_session_id = $1`,
      [voiceSessionId],
    );
  });
}
