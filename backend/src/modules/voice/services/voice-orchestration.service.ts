// src/modules/voice/services/voice-orchestration.service.ts
import { serviceLogger } from '../../../logger/index.js';
import type { VoiceContext, ToolInput } from '../../../types/voice.js';
import type { VapiWebhookMessage, VapiEndOfCallReportMessage } from '../providers/vapi/vapi-types.js';
import { resolveTenantFromCall } from './tenant-resolution.service.js';
import { getOrCreateCallAndSession, markCallEnded } from './call-session.service.js';
import { processEvent } from './event-processing.service.js';
import { updateEventStatus } from '../repositories/voice-events.repository.js';
import { dispatchTools } from '../orchestration/resolve-tool.js';
import {
  extractCallerId,
  extractCalledNumber,
  extractProviderAgentId,
  extractProviderCallId,
  extractToolInputs,
  buildToolCallsResponse,
} from '../providers/vapi/vapi-adapter.js';
import { mapVapiMessageTypeToEventType, mapVapiMessageToNormalizedPayload } from '../mappers/voice-event.mapper.js';

const log = serviceLogger.child({ name: 'voice.orchestration' });

/**
 * Top-level orchestrator for inbound VAPI webhook messages.
 *
 * Responsibilities:
 *   1. Resolve tenant (never from payload)
 *   2. Get or create call + session
 *   3. Persist raw event (received)
 *   4. Route to the correct handler (tool dispatch, end-of-call, etc.)
 *
 * Returns a provider-shaped response (for tool-calls) or a standard ack.
 */
export async function handleVapiMessage(
  message: VapiWebhookMessage,
): Promise<unknown> {
  const callerNumber = extractCallerId(message);
  const calledNumber = extractCalledNumber(message);
  const providerAgentId = extractProviderAgentId(message);
  const providerCallId = extractProviderCallId(message);

  log.info({ messageType: message.type, providerCallId, providerAgentId }, 'incoming VAPI webhook');

  // Step 1: Resolve tenant — hard failure if not found
  const agent = await resolveTenantFromCall({ calledNumber, providerAgentId });

  // Step 2: Ensure call + session exist
  const { call, session } = await getOrCreateCallAndSession({
    agent,
    providerCallId,
    callerNumber,
  });

  const voiceContext: VoiceContext = {
    tenantId: agent.tenant_id,
    agent,
    track: session.track_type,
    call,
    session,
  };

  // Step 3: Persist raw event as 'received'
  const rawPayload = message as unknown as Record<string, unknown>;
  const normalizedPayload = mapVapiMessageToNormalizedPayload(message);
  const eventType = mapVapiMessageTypeToEventType(message.type) ?? message.type;

  const voiceEvent = await processEvent({
    tenantId: agent.tenant_id,
    voiceProviderId: agent.voice_provider_id,
    voiceCallId: call.id,
    voiceSessionId: session.id,
    eventType,
    rawPayload,
    normalizedPayload,
    processingStatus: 'received',
    eventTs: message.timestamp,
  });

  // Step 4: Route by message type — update event status on outcome
  try {
    let result: unknown;

    switch (message.type) {
      case 'tool-calls': {
        const tools: ToolInput[] = extractToolInputs(message);
        const results = await dispatchTools(voiceContext, tools);
        result = buildToolCallsResponse(
          results.map((r, i) => ({ ...r, tool_call_id: (tools[i] as any)._vapiToolCallId })),
        );
        break;
      }

      case 'end-of-call-report': {
        const report = message as VapiEndOfCallReportMessage;
        await markCallEnded({
          tenantId: agent.tenant_id,
          callId: call.id,
          durationSeconds: report.durationSeconds,
          summary: report.summary,
        });
        result = { success: true, accepted: true, request_id: '' };
        break;
      }

      case 'status-update':
        // TODO: Map VAPI status to internal VoiceCallStatus and persist
        result = { success: true, accepted: true, request_id: '' };
        break;

      default:
        result = { success: true, accepted: true, request_id: '' };
    }

    await updateEventStatus(agent.tenant_id, voiceEvent.id, 'processed');
    log.info({ tenantId: agent.tenant_id, eventId: voiceEvent.id, eventType }, 'voice event processed');
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'processing error';
    await updateEventStatus(agent.tenant_id, voiceEvent.id, 'failed', errorMessage).catch((updateErr) => {
      log.error({ eventId: voiceEvent.id, err: updateErr }, 'failed to update event status after processing failure');
    });
    log.error({ tenantId: agent.tenant_id, eventId: voiceEvent.id, eventType, err }, 'voice event processing failed');
    throw err;
  }
}

