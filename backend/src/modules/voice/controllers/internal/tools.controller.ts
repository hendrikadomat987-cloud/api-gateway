// src/modules/voice/controllers/internal/tools.controller.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { listToolInvocationsBySessionId } from '../../repositories/voice-tool-invocations.repository.js';
import { findSessionById } from '../../repositories/voice-sessions.repository.js';
import { VoiceSessionNotFoundError } from '../../../../errors/voice-errors.js';

/**
 * GET /api/v1/voice/sessions/:id/tools
 * Returns the tool invocation history for a session (C.2.5).
 */
export async function listToolInvocationsHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const session = await findSessionById(request.tenantId, request.params.id);
  if (!session || session.tenant_id !== request.tenantId) {
    throw new VoiceSessionNotFoundError(request.params.id);
  }

  const invocations = await listToolInvocationsBySessionId(request.tenantId, session.id);
  reply.send({ success: true, data: invocations });
}
