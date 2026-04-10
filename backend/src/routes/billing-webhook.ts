// src/routes/billing-webhook.ts
//
// Phase 5A: Stripe webhook receiver.
//
// This plugin is intentionally encapsulated (no fp) so the raw-body content
// type parser override applies only to this route.  Stripe requires the raw
// request body for signature verification — JSON-parsed bodies break HMAC.
//
// Route:
//   POST /api/v1/internal/billing/webhook
//
// Auth: Stripe-Signature header (verified inside billing.service.handleWebhook)
// No JWT required — this endpoint is called by Stripe, not by tenant clients.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { handleWebhook } from '../modules/billing/services/billing.service.js';
import { AppError } from '../errors/index.js';
import type { Config } from '../config/env.js';

export async function billingWebhookRoutes(
  app:  FastifyInstance,
  opts: { config: Config },
): Promise<void> {
  const { config } = opts;

  // Override the inherited application/json parser so the body arrives as a raw
  // Buffer.  Fastify v5 requires removing the parent's parser before adding ours.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  // ── POST /api/v1/internal/billing/webhook ─────────────────────────────────
  app.post(
    '/api/v1/internal/billing/webhook',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET) {
        throw new AppError(503, 'BILLING_DISABLED', 'Billing webhooks are not configured');
      }

      const signature = request.headers['stripe-signature'];
      if (!signature || typeof signature !== 'string') {
        throw new AppError(400, 'MISSING_SIGNATURE', 'stripe-signature header is required');
      }

      const rawBody = request.body as Buffer;

      const result = await handleWebhook(rawBody, signature, config);
      return reply.status(200).send({ success: true, ...result });
    },
  );
}
