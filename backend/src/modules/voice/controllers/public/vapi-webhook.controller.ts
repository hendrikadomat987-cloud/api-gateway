// src/modules/voice/controllers/public/vapi-webhook.controller.ts
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyRequest, FastifyReply, RouteHandler } from 'fastify';
import { validateVapiPayload } from '../../services/provider-validation.service.js';
import { handleVapiMessage } from '../../services/voice-orchestration.service.js';
import { extractMessage } from '../../providers/vapi/vapi-adapter.js';
import { verifyVapiSignature } from '../../providers/vapi/vapi-signature.js';
import { InvalidProviderSignatureError } from '../../../../errors/voice-errors.js';
import { serviceLogger } from '../../../../logger/index.js';

const log = serviceLogger.child({ name: 'voice.webhook.vapi' });

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

    // ── TEMPORARY: raw webhook capture (remove once real fixtures are complete) ──
    // Enable by setting VOICE_CAPTURE_RAW_WEBHOOKS=true in the backend .env.
    // Writes one JSON file per incoming webhook to test-engine-v2/fixtures/voice/live/captured/
    if (process.env.VOICE_CAPTURE_RAW_WEBHOOKS === 'true') {
      const rawDir = path.resolve(process.cwd(), '../test-engine-v2/fixtures/voice/live/captured');
      fs.mkdirSync(rawDir, { recursive: true });

      const rawType =
        request.body &&
        typeof request.body === 'object' &&
        'message' in request.body &&
        request.body.message &&
        typeof request.body.message === 'object' &&
        'type' in request.body.message
          ? String((request.body as any).message.type)
          : 'unknown';

      const rawCallId =
        request.body &&
        typeof request.body === 'object' &&
        'message' in request.body &&
        request.body.message &&
        typeof request.body.message === 'object' &&
        'call' in request.body.message &&
        (request.body as any).message.call &&
        typeof (request.body as any).message.call === 'object' &&
        'id' in (request.body as any).message.call
          ? String((request.body as any).message.call.id)
          : 'no-call-id';

      const rawFilename = `${Date.now()}-${rawType}-${rawCallId}.json`
        .replace(/[<>:"/\\|?*\s]+/g, '_');

      fs.writeFileSync(
        path.join(rawDir, rawFilename),
        JSON.stringify(request.body, null, 2),
        'utf8',
      );
    }
    // ── END TEMPORARY ──────────────────────────────────────────────────────────

    const payload = validateVapiPayload(request.body);
    const message = extractMessage(payload);

    log.info(
      {
        type: message.type,
        providerCallId: message.call.id,
        assistantId: message.call.assistantId,
        phoneNumberId: message.call.phoneNumberId,
      },
      '[voice:webhook:incoming]',
    );

    const result = await handleVapiMessage(message);

    reply.status(200).send(result);
  };
}
