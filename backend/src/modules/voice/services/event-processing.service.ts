// src/modules/voice/services/event-processing.service.ts
import { serviceLogger } from '../../../logger/index.js';
import {
  findEventByProviderEventId,
  createEvent,
} from '../repositories/voice-events.repository.js';
import { VoiceInternalError } from '../../../errors/voice-errors.js';
import { buildIdempotencyKey } from '../utils/idempotency.js';
import type { VoiceEvent, VoiceEventProcessingStatus } from '../../../types/voice.js';

const log = serviceLogger.child({ name: 'voice.event-processing' });

/**
 * Persists a voice event with idempotency protection.
 *
 * If the provider supplies a provider_event_id, it is used for deduplication.
 * Otherwise a deterministic key is computed from callId + eventType + payload hash.
 *
 * Throws VoiceInternalError on unexpected duplicate detection outside normal flow.
 */
export async function processEvent(opts: {
  tenantId: string;
  voiceProviderId: string;
  voiceCallId?: string;
  voiceSessionId?: string;
  eventType: string;
  providerEventId?: string;
  rawPayload: Record<string, unknown>;
  normalizedPayload?: Record<string, unknown>;
  processingStatus?: VoiceEventProcessingStatus;
  eventTs?: string;
}): Promise<VoiceEvent> {
  const {
    tenantId,
    voiceProviderId,
    voiceCallId,
    voiceSessionId,
    eventType,
    rawPayload,
    normalizedPayload,
    processingStatus = 'received',
    eventTs,
  } = opts;

  // Deduplicate by provider_event_id when available
  const providerEventId =
    opts.providerEventId ??
    buildIdempotencyKey(voiceCallId ?? voiceProviderId, eventType, rawPayload);

  const ctx = { tenantId, voiceProviderId, voiceCallId, voiceSessionId, eventType, providerEventId };

  log.info(ctx, 'processing voice event');

  const existing = await findEventByProviderEventId(tenantId, voiceProviderId, providerEventId);
  if (existing) {
    log.info({ ...ctx, eventId: existing.id }, 'duplicate voice event — returning existing (idempotent)');
    return existing;
  }

  try {
    const event = await createEvent({
      tenant_id: tenantId,
      voice_provider_id: voiceProviderId,
      voice_call_id: voiceCallId,
      voice_session_id: voiceSessionId,
      provider_event_id: providerEventId,
      event_type: eventType,
      event_ts: eventTs,
      raw_payload_json: rawPayload,
      normalized_payload_json: normalizedPayload,
      processing_status: processingStatus,
    });
    log.info({ ...ctx, eventId: event.id }, 'voice event persisted');
    return event;
  } catch (err) {
    log.error({ ...ctx, err }, 'failed to persist voice event');
    throw err;
  }
}

