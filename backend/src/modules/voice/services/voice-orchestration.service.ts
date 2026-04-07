// src/modules/voice/services/voice-orchestration.service.ts
import { serviceLogger } from '../../../logger/index.js';
import type { VoiceContext, ToolInput } from '../../../types/voice.js';
import type { VapiWebhookMessage, VapiEndOfCallReportMessage } from '../providers/vapi/vapi-types.js';
import { resolveTenantFromCall } from './tenant-resolution.service.js';
import { getOrCreateCallAndSession, markCallEnded } from './call-session.service.js';
import { processEvent } from './event-processing.service.js';
import {
  findEventById,
  updateEventStatus,
  resetRetryCount,
} from '../repositories/voice-events.repository.js';
import { findCallById } from '../repositories/voice-calls.repository.js';
import { findAgentByIdForTenant } from '../repositories/voice-agents.repository.js';
import { findSessionById, updateSession } from '../repositories/voice-sessions.repository.js';
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
import {
  VoiceEventNotFoundError,
  VoiceEventNotRetryableError,
  VoiceCallNotFoundError,
  VoiceSessionNotFoundError,
  VoiceInternalError,
} from '../../../errors/voice-errors.js';

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

  log.info(
    { type: message.type, providerCallId },
    '[voice:orchestrator:start]',
  );
  log.info(
    {
      messageType: message.type,
      providerCallId,
      providerAgentId,
      phoneNumberId: message.call.phoneNumberId,
      timestamp: message.timestamp,
      callerNumber,
      calledNumber,
    },
    'incoming VAPI webhook',
  );

  // Step 1: Resolve tenant — hard failure if not found
  log.debug({ providerCallId }, '[voice:orchestrator:step] tenant');
  let agent;
  try {
    agent = await resolveTenantFromCall({ calledNumber, providerAgentId });
    log.info(
      { providerCallId, tenantId: agent.tenant_id, agentId: agent.id, via: calledNumber ? 'phoneNumber' : 'assistant' },
      '[voice:tenant:resolved]',
    );
  } catch (err) {
    log.warn(
      { providerCallId, calledNumber, providerAgentId, err: err instanceof Error ? err.message : err },
      '[voice:tenant:failed]',
    );
    throw err;
  }

  // Step 2: Ensure call + session exist
  log.debug({ providerCallId }, '[voice:orchestrator:step] call+session');
  let call, session;
  try {
    ({ call, session } = await getOrCreateCallAndSession({
      agent,
      providerCallId,
      callerNumber,
    }));
    log.info(
      { providerCallId, callId: call.id, sessionId: session.id, tenantId: agent.tenant_id },
      'call and session ready',
    );
  } catch (err) {
    log.warn(
      { providerCallId, tenantId: agent.tenant_id, err: err instanceof Error ? err.message : err },
      'call/session creation failed',
    );
    throw err;
  }

  const voiceContext: VoiceContext = {
    tenantId: agent.tenant_id,
    agent,
    track: session.track_type,
    call,
    session,
  };

  // Step 3: Persist raw event as 'received'
  log.debug({ providerCallId, callId: call.id }, '[voice:orchestrator:step] event');
  const rawPayload = message as unknown as Record<string, unknown>;
  const normalizedPayload = mapVapiMessageToNormalizedPayload(message);
  const eventType = mapVapiMessageTypeToEventType(message.type) ?? message.type;

  // [a] After event-type mapping
  log.debug(
    {
      providerMessageType: message.type,
      mappedEventType: eventType,
      providerCallId,
      callId: call.id,
      sessionId: session.id,
    },
    '[voice:event:mapped]',
  );

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

  // [b] After processEvent()
  log.debug(
    {
      eventId: voiceEvent.id,
      processingStatus: voiceEvent.processing_status,
      eventType,
      tenantId: agent.tenant_id,
      callId: call.id,
      sessionId: session.id,
    },
    '[voice:event:persisted]',
  );

  // Step 4: Skip dispatch for duplicate events.
  // processEvent() returns the pre-existing row on duplicate — its status will
  // never be 'received' (that is only set on a freshly created row). Dispatching
  // again would re-run tool handlers, markCallEnded, etc. for the same payload.
  if (voiceEvent.processing_status !== 'received') {
    log.info(
      { tenantId: agent.tenant_id, eventId: voiceEvent.id, eventType, status: voiceEvent.processing_status },
      'duplicate voice event — skipping dispatch (idempotent)',
    );
    return { success: true, accepted: true, request_id: voiceEvent.id };
  }

  // Step 5: Route by message type — update event status on outcome
  return dispatchAndSettle(agent.tenant_id, voiceEvent.id, eventType, voiceContext, message);
}

/**
 * Routes a VAPI message to the correct handler and updates the event status.
 * Shared by the normal webhook path and the manual retry path.
 */
async function dispatchAndSettle(
  tenantId: string,
  eventId: string,
  eventType: string,
  voiceContext: VoiceContext,
  message: VapiWebhookMessage,
): Promise<unknown> {
  const logCtx = {
    tenantId,
    callId: voiceContext.call.id,
    sessionId: voiceContext.session.id,
    eventId,
    eventType,
  };
  try {
    const result = await routeVapiMessage(voiceContext, message);
    await updateEventStatus(tenantId, eventId, 'processed');
    log.info(logCtx, 'voice event processed');
    log.info({ ...logCtx, success: true }, '[voice:orchestrator:end]');
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'processing error';
    await updateEventStatus(tenantId, eventId, 'failed', errorMessage).catch((updateErr) => {
      log.error({ ...logCtx, err: updateErr }, 'failed to update event status after processing failure');
    });
    log.error({ ...logCtx, err }, 'voice event processing failed');
    log.warn({ ...logCtx, success: false, reason: errorMessage }, '[voice:orchestrator:end]');
    throw err;
  }
}

/**
 * Pure routing: maps a VAPI message type to the correct domain operation.
 * Does not persist events or update statuses.
 */
async function routeVapiMessage(
  voiceContext: VoiceContext,
  message: VapiWebhookMessage,
): Promise<unknown> {
  switch (message.type) {
    case 'tool-calls': {
      const tools: ToolInput[] = extractToolInputs(message);

      // [c] Before tool dispatch
      log.info(
        {
          callId: voiceContext.call.id,
          sessionId: voiceContext.session.id,
          track: voiceContext.track,
          tools: tools.map((t) => ({ name: t.name, arguments: t.arguments })),
        },
        '[voice:tool:triggered]',
      );

      const results = await dispatchTools(voiceContext, tools);

      // [d] After tool dispatch
      log.info(
        {
          callId: voiceContext.call.id,
          sessionId: voiceContext.session.id,
          track: voiceContext.track,
          results,
        },
        '[voice:tool:dispatched]',
      );

      const response = buildToolCallsResponse(
        results.map((r, i) => ({ ...r, tool_call_id: (tools[i] as any)._vapiToolCallId })),
      );

      // [e] Before returning to Vapi
      log.info(
        {
          callId: voiceContext.call.id,
          sessionId: voiceContext.session.id,
          response,
        },
        '[voice:tool:response]',
      );

      return response;
    }

    case 'end-of-call-report': {
      const report = message as VapiEndOfCallReportMessage;
      await markCallEnded({
        tenantId: voiceContext.tenantId,
        callId: voiceContext.call.id,
        durationSeconds: report.durationSeconds,
        summary: report.summary,
      });
      await updateSession(voiceContext.tenantId, voiceContext.session.id, { status: 'completed' });
      return { success: true, accepted: true, request_id: '' };
    }

    case 'status-update':
      // TODO: Map VAPI status to internal VoiceCallStatus and persist
      return { success: true, accepted: true, request_id: '' };

    default:
      return { success: true, accepted: true, request_id: '' };
  }
}

/**
 * Replays a failed voice event by reloading its stored raw payload and
 * re-running the routing logic. Only events with processing_status = 'failed'
 * are eligible. Idempotency keys are not re-evaluated — the event record
 * already exists and only its status is updated on outcome.
 */
export async function replayFailedEvent(
  tenantId: string,
  eventId: string,
): Promise<void> {
  const event = await findEventById(tenantId, eventId);
  if (!event) throw new VoiceEventNotFoundError(eventId);
  if (event.processing_status !== 'failed' && event.processing_status !== 'dead_letter') {
    throw new VoiceEventNotRetryableError(eventId, event.processing_status);
  }

  log.info(
    { tenantId, eventId, eventType: event.event_type, fromStatus: event.processing_status },
    'voice event retry requested',
  );

  // Manual retry of a dead_letter event resets the retry counter so the event
  // gets a fresh set of automatic retries if it fails again.
  if (event.processing_status === 'dead_letter') {
    await resetRetryCount(tenantId, eventId);
  }

  if (!event.voice_call_id) throw new VoiceInternalError(`Event ${eventId} has no associated call`);
  if (!event.voice_session_id) throw new VoiceInternalError(`Event ${eventId} has no associated session`);

  const call = await findCallById(tenantId, event.voice_call_id);
  if (!call) throw new VoiceCallNotFoundError(event.voice_call_id);

  if (!call.voice_agent_id) throw new VoiceInternalError(`Call ${call.id} has no associated agent`);
  const agent = await findAgentByIdForTenant(tenantId, call.voice_agent_id);
  if (!agent) throw new VoiceInternalError(`Agent ${call.voice_agent_id} not found for retry`);

  const session = await findSessionById(tenantId, event.voice_session_id);
  if (!session) throw new VoiceSessionNotFoundError(event.voice_session_id);

  const voiceContext: VoiceContext = {
    tenantId,
    agent,
    track: session.track_type,
    call,
    session,
  };

  const message = event.raw_payload_json as unknown as VapiWebhookMessage;

  await dispatchAndSettle(tenantId, eventId, event.event_type, voiceContext, message);
}

