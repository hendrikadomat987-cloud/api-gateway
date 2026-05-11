// src/modules/voice/controllers/internal/events.controller.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { listEventsByVoiceCallId } from '../../repositories/voice-events.repository.js';
import { findCallById } from '../../repositories/voice-calls.repository.js';
import { replayFailedEvent } from '../../services/voice-orchestration.service.js';

export async function listEventsHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const call = await findCallById(request.tenantId, request.params.id);
  if (!call) {
    return reply.send({ success: true, data: [] });
  }

  const events = await listEventsByVoiceCallId(request.tenantId, call.id);
  reply.send({ success: true, data: events ?? [] });
}

export async function retryEventHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  await replayFailedEvent(request.tenantId, request.params.id);
  reply.status(200).send({ success: true });
}
