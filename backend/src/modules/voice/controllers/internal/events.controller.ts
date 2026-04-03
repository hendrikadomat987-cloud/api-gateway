// src/modules/voice/controllers/internal/events.controller.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { listEventsByVoiceCallId } from '../../repositories/voice-events.repository.js';
import { findCallById } from '../../repositories/voice-calls.repository.js';
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
