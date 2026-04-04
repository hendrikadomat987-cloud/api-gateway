// src/modules/voice/tools/restaurant/create-restaurant-callback-request.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';
import { createCallbackRequest } from '../../repositories/voice-callback-requests.repository.js';

/**
 * create_restaurant_callback_request
 *
 * Creates a callback request when a restaurant caller needs a follow-up.
 * Persists the request with track_type 'restaurant' and status 'pending'.
 */
export async function runCreateRestaurantCallbackRequest(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const callbackRequest = await createCallbackRequest({
    tenant_id:        context.tenantId,
    voice_call_id:    context.call.id,
    voice_session_id: context.session.id,
    track_type:       'restaurant',
    caller_number:    context.call.caller_number ?? '',
    preferred_time:   typeof args.preferred_time === 'string' ? args.preferred_time : undefined,
    notes:            typeof args.notes === 'string' ? args.notes : undefined,
    status:           'pending',
    n8n_workflow_id:  undefined,
  });

  return { success: true, callback_request_id: callbackRequest.id };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function createRestaurantCallbackRequestTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: create_restaurant_callback_request route');
}
