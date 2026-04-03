// src/modules/voice/mappers/voice-event.mapper.ts
import type { VoiceEvent, VoiceEventProcessingStatus } from '../../../types/voice.js';
import type { VapiWebhookMessage } from '../providers/vapi/vapi-types.js';

/**
 * Maps VAPI webhook message types to internal event_type strings.
 */
export function mapVapiMessageTypeToEventType(vapiType: string): string | null {
  const map: Record<string, string> = {
    'assistant-request': 'session.created',
    'end-of-call-report': 'call.ended',
    'status-update': 'call.status_update',
    'transcript': 'speech.user',
    'tool-calls': 'tool.invoked',
    'function-call': 'tool.invoked',
    'hang': 'call.hang',
  };
  return map[vapiType] ?? null;
}

/**
 * Maps a raw VAPI message to the processing_status that should be set on creation.
 */
export function mapVapiMessageToInitialProcessingStatus(
  _vapiType: string,
): VoiceEventProcessingStatus {
  // All events start as 'received'; the orchestration layer advances the status.
  return 'received';
}

/**
 * Strips the call sub-object from a VAPI message for normalized payload storage.
 * The call reference is already captured on the VoiceCall record.
 */
export function mapVapiMessageToNormalizedPayload(
  message: VapiWebhookMessage,
): Record<string, unknown> {
  // TODO: Implement field-by-field normalisation per message type.
  const { call: _call, ...rest } = (message as unknown as Record<string, unknown>);
  return rest;
}

/**
 * Builds a client-safe representation of a VoiceEvent.
 */
export function toPublicEvent(event: VoiceEvent): Record<string, unknown> {
  return {
    id: event.id,
    voiceCallId: event.voice_call_id,
    voiceSessionId: event.voice_session_id,
    eventType: event.event_type,
    processingStatus: event.processing_status,
    createdAt: event.created_at,
  };
}
