// src/routes/voice/public.ts
import type { FastifyInstance } from 'fastify';
import { vapiWebhookController } from '../../modules/voice/controllers/public/vapi-webhook.controller.js';

/**
 * Public voice routes — no JWT auth.
 * Entry point for provider webhooks (VAPI only in V1).
 * Tenant resolution happens inside the controller via phone number or provider_agent_id.
 */
export async function voicePublicRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/voice/providers/vapi/webhook
  app.post('/api/v1/voice/providers/vapi/webhook', vapiWebhookController);
}
