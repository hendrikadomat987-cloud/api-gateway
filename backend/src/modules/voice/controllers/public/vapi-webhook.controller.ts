// src/modules/voice/controllers/public/vapi-webhook.controller.ts
import type { FastifyRequest, FastifyReply, RouteHandler } from 'fastify';
import { validateVapiPayload } from '../../services/provider-validation.service.js';
import { handleVapiMessage } from '../../services/voice-orchestration.service.js';
import { extractMessage } from '../../providers/vapi/vapi-adapter.js';
import { verifyVapiSignature } from '../../providers/vapi/vapi-signature.js';
import { InvalidProviderSignatureError } from '../../../../errors/voice-errors.js';

/**
 * Factory for the public VAPI webhook controller.
 *
 * Security notes:
 *   - No JWT auth; authentication is done via VAPI signature verification.
 *   - Tenant is NEVER derived from the payload — resolved internally by the
 *     orchestration service via phone number or provider_agent_id.
 *   - verifyVapiSignature() is always called before any payload processing.
 *   - A missing rawBody is a hard failure — no silent bypass.
 */
export function createVapiWebhookController(vapiWebhookSecret: string): RouteHandler {
  return async function vapiWebhookController(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!request.rawBody) {
      throw new InvalidProviderSignatureError('Raw body unavailable for signature verification');
    }
    const signature = request.headers['x-vapi-signature'] as string | undefined;
    verifyVapiSignature(request.rawBody, signature, vapiWebhookSecret);

    const payload = validateVapiPayload(request.body);
    const message = extractMessage(payload);

    const result = await handleVapiMessage(message);

    reply.status(200).send(result);
  };
}
