// src/modules/voice/controllers/internal/events.controller.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { listEventsByVoiceCallId } from '../../repositories/voice-events.repository.js';
import { findCallById } from '../../repositories/voice-calls.repository.js';
import { replayFailedEvent } from '../../services/voice-orchestration.service.js';
import { VoiceCallNotFoundError } from '../../../../errors/voice-errors.js';

export async function listEventsHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const call = await findCallById(request.tenantId, request.params.id);
  if (!call || call.tenant_id !== request.tenantId) {
    throw new VoiceCallNotFoundError(request.params.id);
  }

  const events = await listEventsByVoiceCallId(request.tenantId, call.id);
  reply.send({ success: true, data: events });
}

export async function retryEventHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  await replayFailedEvent(request.tenantId, request.params.id);
  reply.status(200).send({ success: true });
}
