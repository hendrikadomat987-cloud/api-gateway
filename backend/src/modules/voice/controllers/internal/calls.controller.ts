// src/modules/voice/controllers/internal/calls.controller.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { listCallsByTenantId, findCallById } from '../../repositories/voice-calls.repository.js';
import { findSessionByVoiceCallId } from '../../repositories/voice-sessions.repository.js';

export async function listCallsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const calls = await listCallsByTenantId(request.tenantId);
  reply.send({ success: true, data: calls ?? [] });
}

export async function getCallHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const call = await findCallById(request.tenantId, request.params.id);
  if (!call) {
    return reply.send({ success: true, data: null });
  }
  reply.send({ success: true, data: call });
}

export async function getCallSessionHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const call = await findCallById(request.tenantId, request.params.id);
  if (!call) {
    return reply.send({ success: true, data: null });
  }

  const session = await findSessionByVoiceCallId(request.tenantId, call.id);
  if (!session) {
    return reply.send({ success: true, data: null });
  }

  reply.send({ success: true, data: session });
}
