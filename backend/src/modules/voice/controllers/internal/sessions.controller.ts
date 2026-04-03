// src/modules/voice/controllers/internal/sessions.controller.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { findSessionById, updateSession } from '../../repositories/voice-sessions.repository.js';
import { markCallFallback, markCallHandover } from '../../services/call-session.service.js';
import { VoiceSessionNotFoundError } from '../../../../errors/voice-errors.js';

export async function getSessionHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const session = await findSessionById(request.tenantId, request.params.id);
  if (!session || session.tenant_id !== request.tenantId) {
    throw new VoiceSessionNotFoundError(request.params.id);
  }
  reply.send({ success: true, data: session });
}

/** C.3.1 — Controlled fallback transition. */
export async function setSessionFallbackHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const session = await findSessionById(request.tenantId, request.params.id);
  if (!session || session.tenant_id !== request.tenantId) {
    throw new VoiceSessionNotFoundError(request.params.id);
  }

  const updatedSession = await updateSession(request.tenantId, request.params.id, {
    status: 'fallback',
  });

  await markCallFallback({
    tenantId: request.tenantId,
    callId: session.voice_call_id,
    reason: 'manual_fallback',
  });

  reply.send({ success: true, data: updatedSession });
}

/** C.3.2 — Controlled handover transition. */
export async function setSessionHandoverHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const session = await findSessionById(request.tenantId, request.params.id);
  if (!session || session.tenant_id !== request.tenantId) {
    throw new VoiceSessionNotFoundError(request.params.id);
  }

  const updatedSession = await updateSession(request.tenantId, request.params.id, {
    status: 'handover',
  });

  await markCallHandover({
    tenantId: request.tenantId,
    callId: session.voice_call_id,
    reason: 'manual_handover',
  });

  reply.send({ success: true, data: updatedSession });
}