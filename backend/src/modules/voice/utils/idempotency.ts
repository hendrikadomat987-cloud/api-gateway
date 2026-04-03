// src/modules/voice/utils/idempotency.ts
import { createHash } from 'node:crypto';

/**
 * Builds a deterministic idempotency key for a voice event.
 * Format: sha256(<callId>:<eventType>:<stablePayloadHash>)
 */
export function buildIdempotencyKey(
  callId: string,
  eventType: string,
  payload: Record<string, unknown>,
): string {
  const payloadHash = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 16);

  return createHash('sha256')
    .update(`${callId}:${eventType}:${payloadHash}`)
    .digest('hex');
}
