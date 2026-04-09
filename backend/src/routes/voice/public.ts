// src/routes/voice/public.ts
import type { FastifyInstance } from 'fastify';
import type { Config } from '../../config/env.js';
import { createVapiWebhookController } from '../../modules/voice/controllers/public/vapi-webhook.controller.js';

/**
 * Public voice routes — no JWT auth.
 * Entry point for provider webhooks (VAPI only in V1).
 * Tenant resolution happens inside the controller via phone number or provider_agent_id.
 *
 * Registers a scoped application/json content-type parser that captures the raw
 * body Buffer before JSON parsing — required for VAPI signature verification.
 * This parser applies only to routes registered in this plugin scope.
 */
export async function voicePublicRoutes(
  app: FastifyInstance,
  opts: { config: Config },
): Promise<void> {
  // Capture rawBody as Buffer before JSON-parsing — scoped to this plugin only.
  // Remove the inherited root-scope parser first (Fastify v5 requires this when
  // the parent has already registered a custom application/json parser).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    try {
      (_req as any).rawBody = body;
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // POST /api/v1/voice/providers/vapi/webhook
  app.post(
    '/api/v1/voice/providers/vapi/webhook',
    createVapiWebhookController(opts.config.VAPI_WEBHOOK_SECRET),
  );
}
