// src/modules/voice/tools/restaurant/create-restaurant-callback-request.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * create_restaurant_callback_request
 *
 * Creates a callback request for a restaurant call where the caller needs a follow-up.
 *
 * TODO: Implement callback persistence and n8n notification trigger.
 */
export async function runCreateRestaurantCallbackRequest(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  throw new Error('Not implemented: create_restaurant_callback_request');
}

/** Route handler for direct HTTP invocation (testing only). */
export async function createRestaurantCallbackRequestTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: create_restaurant_callback_request route');
}
