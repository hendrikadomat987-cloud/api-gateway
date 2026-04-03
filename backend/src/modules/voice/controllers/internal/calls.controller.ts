// src/modules/voice/controllers/internal/calls.controller.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { listCallsByTenantId, findCallById } from '../../repositories/voice-calls.repository.js';
import { findSessionByVoiceCallId } from '../../repositories/voice-sessions.repository.js';
import { VoiceCallNotFoundError, VoiceSessionNotFoundError } from '../../../../errors/voice-errors.js';

export async function listCallsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const calls = await listCallsByTenantId(request.tenantId);
  reply.send({ success: true, data: calls });
}

export async function getCallHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const call = await findCallById(request.tenantId, request.params.id);
  if (!call || call.tenant_id !== request.tenantId) {
    throw new VoiceCallNotFoundError(request.params.id);
  }
  reply.send({ success: true, data: call });
}

export async function getCallSessionHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const call = await findCallById(request.tenantId, request.params.id);
  if (!call || call.tenant_id !== request.tenantId) {
    throw new VoiceCallNotFoundError(request.params.id);
  }

  const session = await findSessionByVoiceCallId(request.tenantId, call.id);
  if (!session) {
    throw new VoiceSessionNotFoundError(call.id);
  }

  reply.send({ success: true, data: session });
}
