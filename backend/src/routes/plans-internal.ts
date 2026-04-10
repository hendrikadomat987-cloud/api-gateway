// src/routes/plans-internal.ts
//
// Pricing & Plan System V1 — internal management endpoints.
// All routes require a valid JWT with tenant context.
//
// Routes:
//   POST /internal/plans/assign   { "plan": "<key>" }
//   GET  /internal/plans/current

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { resolveTenantContext } from '../middleware/tenantContext.js';
import { featureService } from '../modules/features/services/feature.service.js';
import { ValidationError, NotFoundError } from '../errors/index.js';

const preHandler = [authenticate, resolveTenantContext];

export async function plansInternalRoutes(app: FastifyInstance): Promise<void> {
  // ── Assign plan ────────────────────────────────────────────────────────────

  app.post(
    '/api/v1/internal/plans/assign',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { plan } = request.body as Record<string, unknown>;
      if (typeof plan !== 'string' || !plan.trim()) {
        throw new ValidationError('Body must contain a non-empty "plan" string');
      }

      try {
        await featureService.assignPlan(request.tenantId, plan.trim());
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Unknown plan")) {
          throw new NotFoundError(err.message, 'PLAN_NOT_FOUND');
        }
        throw err;
      }

      return reply.send({ success: true, data: { plan: plan.trim() } });
    },
  );

  // ── Get current plan ───────────────────────────────────────────────────────

  app.get(
    '/api/v1/internal/plans/current',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const planRow = await featureService.getCurrentPlan(request.tenantId);

      if (!planRow) {
        return reply.send({ success: true, data: { plan: null } });
      }

      return reply.send({
        success: true,
        data: {
          plan: {
            key:         planRow.plan_key,
            name:        planRow.plan_name,
            assigned_at: planRow.assigned_at,
          },
        },
      });
    },
  );
}
