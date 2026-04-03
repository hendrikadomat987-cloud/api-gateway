// src/modules/voice/services/voice-orchestration.service.ts
import type { VoiceContext, ToolInput } from '../../../types/voice.js';
import type { VapiWebhookMessage, VapiEndOfCallReportMessage } from '../providers/vapi/vapi-types.js';
import { resolveTenantFromCall } from './tenant-resolution.service.js';
import { getOrCreateCallAndSession, markCallEnded } from './call-session.service.js';
import { processEvent } from './event-processing.service.js';
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

  // Step 3: Persist raw event
  const rawPayload = message as unknown as Record<string, unknown>;
  const normalizedPayload = mapVapiMessageToNormalizedPayload(message);
  const eventType = mapVapiMessageTypeToEventType(message.type) ?? message.type;

  await processEvent({
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

  // Step 4: Route by message type
  switch (message.type) {
    case 'tool-calls': {
      const tools: ToolInput[] = extractToolInputs(message);
      const results = await dispatchTools(voiceContext, tools);
      return buildToolCallsResponse(
        results.map((r, i) => ({ ...r, tool_call_id: (tools[i] as any)._vapiToolCallId })),
      );
    }

    case 'end-of-call-report': {
      const report = message as VapiEndOfCallReportMessage;
       await markCallEnded({
         tenantId: agent.tenant_id,
         callId: call.id,
         durationSeconds: report.durationSeconds,
         summary: report.summary,
      });
      return { success: true, accepted: true, request_id: '' };
    }

    case 'status-update':
      // TODO: Map VAPI status to internal VoiceCallStatus and persist
      return { success: true, accepted: true, request_id: '' };

    default:
      return { success: true, accepted: true, request_id: '' };
  }
}

