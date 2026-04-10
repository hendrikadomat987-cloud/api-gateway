// src/routes/billing.ts
//
// Phase 5A: Tenant-facing billing endpoints.
//
// All routes require a valid JWT (authenticate + resolveTenantContext).
// tenantId is ALWAYS taken from the verified JWT — never from request body.
//
// Routes:
//   POST  /api/v1/internal/billing/customers/create
//   POST  /api/v1/internal/billing/subscriptions/create
//   GET   /api/v1/internal/billing/subscriptions/current
//   POST  /api/v1/internal/billing/subscriptions/cancel

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate }         from '../middleware/auth.js';
import { resolveTenantContext } from '../middleware/tenantContext.js';
import {
  createCustomer,
  createSubscription,
  cancelSubscription,
} from '../modules/billing/services/billing.service.js';
import { getSubscriptionByTenant, getCustomer } from '../modules/billing/repositories/billing.repository.js';
import { ValidationError, AppError } from '../errors/index.js';
import type { Config } from '../config/env.js';

const preHandler = [authenticate, resolveTenantContext];

export async function billingRoutes(
  app:  FastifyInstance,
  opts: { config: Config },
): Promise<void> {
  const { config } = opts;

  // ── POST /customers/create ─────────────────────────────────────────────────
  // Creates a Stripe customer for the calling tenant.
  // Idempotent — safe to call multiple times; returns the existing customer.

  app.post(
    '/api/v1/internal/billing/customers/create',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await createCustomer(request.tenantId, config);
      return reply.send({
        success: true,
        data:    {
          stripe_customer_id: result.stripeCustomerId,
          created:            result.created,
        },
      });
    },
  );

  // ── POST /subscriptions/create ─────────────────────────────────────────────
  // Creates a Stripe subscription for the given plan key.
  // Creates a Stripe customer first if one does not exist.
  //
  // Body: { plan: string }  — must match a plan key with a configured price ID

  app.post(
    '/api/v1/internal/billing/subscriptions/create',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (typeof body.plan !== 'string' || !body.plan.trim()) {
        throw new ValidationError('"plan" must be a non-empty string');
      }
      const planKey = body.plan.trim();

      try {
        const result = await createSubscription(request.tenantId, planKey, config);
        return reply.send({
          success: true,
          data:    {
            stripe_subscription_id: result.stripeSubscriptionId,
            status:                 result.status,
            plan:                   planKey,
          },
        });
      } catch (err) {
        if (err instanceof AppError) throw err;
        if (err instanceof Error && err.message.startsWith("Unknown plan")) {
          throw new AppError(404, 'PLAN_NOT_FOUND', err.message);
        }
        throw err;
      }
    },
  );

  // ── GET /subscriptions/current ─────────────────────────────────────────────
  // Returns the most-recent subscription row for the calling tenant, or null.

  app.get(
    '/api/v1/internal/billing/subscriptions/current',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const [customer, subscription] = await Promise.all([
        getCustomer(request.tenantId),
        getSubscriptionByTenant(request.tenantId),
      ]);
      return reply.send({
        success: true,
        data:    {
          stripe_customer_id:     customer?.stripe_customer_id    ?? null,
          stripe_subscription_id: subscription?.stripe_subscription_id ?? null,
          stripe_price_id:        subscription?.stripe_price_id   ?? null,
          status:                 subscription?.status            ?? null,
          current_period_start:   subscription?.current_period_start ?? null,
          current_period_end:     subscription?.current_period_end   ?? null,
          cancel_at_period_end:   subscription?.cancel_at_period_end ?? null,
        },
      });
    },
  );

  // ── POST /subscriptions/cancel ─────────────────────────────────────────────
  // Cancels the subscription at the end of the current billing period.
  // The tenant retains access until the period expires.

  app.post(
    '/api/v1/internal/billing/subscriptions/cancel',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await cancelSubscription(request.tenantId, config);
      return reply.send({ success: true, data: result });
    },
  );
}
