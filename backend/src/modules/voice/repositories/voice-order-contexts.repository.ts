// src/modules/voice/repositories/voice-order-contexts.repository.ts
import type { VoiceOrderContext } from '../../../types/voice.js';

/**
 * Optional: used only for the restaurant track to persist in-progress order state.
 *
 * TODO: Inject a database client (e.g. Supabase, Postgres).
 * All methods are stubs until the database layer is wired.
 */

export async function findOrderContextBySessionId(
  voiceSessionId: string,
): Promise<VoiceOrderContext | null> {
  // TODO: SELECT * FROM voice_order_contexts WHERE voice_session_id = $1 LIMIT 1
  void voiceSessionId;
  throw new Error('Not implemented: findOrderContextBySessionId');
}

export async function upsertOrderContext(
  voiceCallId: string,
  voiceSessionId: string,
  orderContextJson: Record<string, unknown>,
): Promise<VoiceOrderContext> {
  // TODO: INSERT INTO voice_order_contexts (voice_call_id, voice_session_id, order_context_json, status)
  //       VALUES ($1, $2, $3, 'draft')
  //       ON CONFLICT (voice_session_id) DO UPDATE SET order_context_json = EXCLUDED.order_context_json
  //       RETURNING *
  void voiceCallId;
  void voiceSessionId;
  void orderContextJson;
  throw new Error('Not implemented: upsertOrderContext');
}
