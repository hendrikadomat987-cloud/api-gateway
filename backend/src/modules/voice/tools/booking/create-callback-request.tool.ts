// src/modules/voice/tools/booking/create-callback-request.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * create_callback_request
 *
 * Creates a callback request when the caller cannot or will not book immediately.
 * Persists the request and may trigger a downstream notification (via n8n — TBD).
 *
 * TODO: Implement callback persistence and n8n notification trigger.
 */
export async function runCreateCallbackRequest(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  throw new Error('Not implemented: create_callback_request');
}

/** Route handler for direct HTTP invocation (testing only). */
export async function createCallbackRequestTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: create_callback_request route');
}
