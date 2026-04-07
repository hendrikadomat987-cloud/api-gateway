// src/modules/voice/services/call-session.service.ts
import {
  findCallByProviderCallId,
  createCall,
  updateCall,
} from '../repositories/voice-calls.repository.js';
import {
  findSessionByVoiceCallId,
  createSession,
} from '../repositories/voice-sessions.repository.js';
import { serviceLogger } from '../../../logger/index.js';
import type { VoiceAgent, VoiceCall, VoiceSession } from '../../../types/voice.js';

const log = serviceLogger.child({ name: 'voice.call-session' });

/**
 * Manages the lifecycle of VoiceCalls and VoiceSessions.
 *
 * Called by the event processing / orchestration service to ensure a
 * call + session exist before any event or tool invocation is processed.
 *
 * V1 rule: exactly one active main session per call.
 */

export async function getOrCreateCallAndSession(opts: {
  agent: VoiceAgent;
  providerCallId: string;
  callerNumber?: string;
}): Promise<{ call: VoiceCall; session: VoiceSession }> {
  const { agent, providerCallId, callerNumber } = opts;

  // ── Call ───────────────────────────────────────────────────────────────────
  log.debug({ providerCallId, tenantId: agent.tenant_id }, '[voice:call:lookup]');
  let call = await findCallByProviderCallId(agent.tenant_id, providerCallId);

  if (!call) {
    log.debug({ providerCallId }, '[voice:call:not-found]');
    call = await createCall({
      tenant_id: agent.tenant_id,
      voice_provider_id: agent.voice_provider_id,
      voice_agent_id: agent.id,
      provider_call_id: providerCallId,
      direction: 'inbound',
      caller_number: callerNumber,
      status: 'created',
      // Derive track_type from agent.track_scope; fall back to 'unknown' if multi/unset
      track_type:
        agent.track_scope === 'booking' || agent.track_scope === 'restaurant'
          ? agent.track_scope
          : 'unknown',
    });
    log.info({ providerCallId, callId: call.id, tenantId: call.tenant_id }, '[voice:call:created]');
  } else {
    log.debug({ providerCallId, callId: call.id }, '[voice:call:found]');
  }

  // ── Session ────────────────────────────────────────────────────────────────
  log.debug({ providerCallId, callId: call.id }, '[voice:session:lookup]');
  let session = await findSessionByVoiceCallId(call.tenant_id, call.id);

  if (!session) {
    const trackType =
      agent.track_scope === 'booking' || agent.track_scope === 'restaurant'
        ? agent.track_scope
        : null;

    if (!trackType) {
      // TODO: Hard-fail here once track resolution is fully implemented.
      log.warn(
        { providerCallId, callId: call.id, agentId: agent.id, trackScope: agent.track_scope },
        '[voice:session:skipped] — agent has no resolvable track_scope',
      );
      throw new Error(`Cannot create session: agent ${agent.id} has no resolvable track_scope`);
    }

    session = await createSession({
      tenant_id: agent.tenant_id,
      voice_call_id: call.id,
      track_type: trackType,
      status: 'active',
      context_json: {},
    });
    log.info({ providerCallId, callId: call.id, sessionId: session.id, trackType }, '[voice:session:created]');
  } else {
    log.debug({ providerCallId, callId: call.id, sessionId: session.id }, '[voice:session:found]');
  }

  return { call, session };
}

export async function markCallEnded(opts: {
  tenantId: string;
  callId: string;
  durationSeconds?: number;
  summary?: string;
}): Promise<VoiceCall> {
  return updateCall(opts.tenantId, opts.callId, {
    status: 'completed',
    ended_at: new Date().toISOString(),
    duration_seconds: opts.durationSeconds,
    summary: opts.summary,
  });
}

export async function markCallFallback(opts: {
  tenantId: string;
  callId: string;
  reason: string;
}): Promise<VoiceCall> {
  return updateCall(opts.tenantId, opts.callId, {
    status: 'fallback',
    fallback_reason: opts.reason,
  });
}

export async function markCallHandover(opts: {
  tenantId: string;
  callId: string;
  reason: string;
}): Promise<VoiceCall> {
  return updateCall(opts.tenantId, opts.callId, {
    status: 'handover',
    handover_reason: opts.reason,
  });
}
