// src/modules/voice/controllers/public/vapi-webhook.controller.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateVapiPayload } from '../../services/provider-validation.service.js';
import { handleVapiMessage } from '../../services/voice-orchestration.service.js';
import { extractMessage } from '../../providers/vapi/vapi-adapter.js';

/**
 * Public VAPI webhook controller.
 *
 * Security notes:
 *   - No JWT auth; authentication is done via VAPI signature verification.
 *   - Tenant is NEVER derived from the payload — resolved internally by the
 *     orchestration service via phone number or provider_agent_id.
 *
 * TODO: Wire VAPI_WEBHOOK_SECRET from config and call verifyVapiSignature()
 *       before processing the payload.
 */
export async function vapiWebhookController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // TODO: Verify VAPI signature
  // const rawBody = (request as any).rawBody;
  // const signature = request.headers['x-vapi-signature'] as string | undefined;
  // verifyVapiSignature(rawBody, signature, config.VAPI_WEBHOOK_SECRET);

  const payload = validateVapiPayload(request.body);
  const message = extractMessage(payload);

  const result = await handleVapiMessage(message);

  reply.status(200).send(result);
}
