// src/modules/voice/repositories/voice-salon-contexts.repository.ts
//
// Session-scoped booking context for the Salon track.
// Analogous to voice-order-contexts.repository.ts in the Restaurant domain.

import { withTenant } from '../../../lib/db.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VoiceSalonContext {
  id:                   string;
  tenant_id:            string;
  voice_call_id:        string;
  voice_session_id:     string;
  status:               'draft' | 'awaiting_confirmation' | 'confirmed' | 'cancelled' | 'failed';
  booking_context_json: Record<string, unknown>;
  confirmed_at?:        string;
  created_at:           string;
  updated_at:           string;
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Returns the voice_salon_contexts row for a given session, or null.
 */
export async function findSalonContextBySessionId(
  tenantId: string,
  voiceSessionId: string,
): Promise<VoiceSalonContext | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceSalonContext>(
      `SELECT * FROM voice_salon_contexts WHERE voice_session_id = $1 LIMIT 1`,
      [voiceSessionId],
    );
    return result.rows[0] ?? null;
  });
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Inserts or updates the voice_salon_contexts row for a session.
 * On conflict (same voice_session_id), updates booking_context_json and updated_at.
 */
export async function upsertSalonContext(
  tenantId: string,
  voiceCallId: string,
  voiceSessionId: string,
  bookingContextJson: Record<string, unknown>,
): Promise<VoiceSalonContext> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceSalonContext>(
      `INSERT INTO voice_salon_contexts
         (tenant_id, voice_call_id, voice_session_id, status, booking_context_json)
       VALUES ($1, $2, $3, 'draft', $4)
       ON CONFLICT (voice_session_id)
       DO UPDATE SET
         booking_context_json = EXCLUDED.booking_context_json,
         updated_at           = now()
       RETURNING *`,
      [tenantId, voiceCallId, voiceSessionId, JSON.stringify(bookingContextJson)],
    );
    return result.rows[0];
  });
}

/**
 * Conditionally updates booking_context_json using optimistic locking.
 *
 * Only applies when `updated_at` still matches `expectedUpdatedAt`.
 * Returns 'ok' on success, 'conflict' when a concurrent write raced ahead.
 */
export async function updateSalonContextJson(
  tenantId: string,
  voiceSessionId: string,
  newJson: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<'ok' | 'conflict'> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      `UPDATE voice_salon_contexts
       SET    booking_context_json = $3,
              updated_at           = now()
       WHERE  tenant_id          = $1
         AND  voice_session_id   = $2
         AND  date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $4::timestamptz)`,
      [tenantId, voiceSessionId, JSON.stringify(newJson), expectedUpdatedAt],
    );
    return (result.rowCount ?? 0) > 0 ? 'ok' : 'conflict';
  });
}

/**
 * Sets the voice_salon_contexts row to 'confirmed' and stamps confirmed_at.
 */
export async function confirmSalonContext(
  tenantId: string,
  voiceSessionId: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE voice_salon_contexts
       SET status       = 'confirmed',
           confirmed_at = now(),
           updated_at   = now()
       WHERE voice_session_id = $1`,
      [voiceSessionId],
    );
  });
}
