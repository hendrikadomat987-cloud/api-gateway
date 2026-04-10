// src/routes/usage.ts
//
// Phase 4A: Usage Tracking Routes
//
// Routes:
//   GET    /api/v1/usage/current               — current period usage summary
//   POST   /api/v1/internal/usage/reset        — reset counters for current (or given) period
//   POST   /api/v1/internal/usage/overrides    — upsert a tenant limit override
//   DELETE /api/v1/internal/usage/overrides    — delete a tenant limit override

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { resolveTenantContext } from '../middleware/tenantContext.js';
import { usageService, getLimitType } from '../modules/usage/services/usage.service.js';
import { currentPeriodStart } from '../modules/usage/repositories/usage.repository.js';
import { ValidationError } from '../errors/index.js';

const preHandler = [authenticate, resolveTenantContext];

const PERIOD_RE = /^\d{4}-\d{2}-01$/;

export async function usageRoutes(app: FastifyInstance): Promise<void> {

  // ── GET /api/v1/usage/current ──────────────────────────────────────────────
  //
  // Returns all usage counters for the current billing period with effective limits.
  //
  // Response:
  //   {
  //     success: true,
  //     data: {
  //       period_start: "2026-04-01",
  //       usage: [
  //         { feature_key, limit_type, current_value, limit_value, period_start }
  //       ]
  //     }
  //   }

  app.get(
    '/api/v1/usage/current',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const usage = await usageService.getCurrentUsage(request.tenantId);
      return reply.send({
        success: true,
        data: {
          period_start: currentPeriodStart(),
          usage,
        },
      });
    },
  );

  // ── POST /api/v1/internal/usage/reset ─────────────────────────────────────
  //
  // Resets usage_counters for the calling tenant.
  // Does NOT delete usage_events (immutable audit log).
  //
  // Body (optional): { "period_start": "2026-04-01" }
  //   Omit to reset the current period.

  app.post(
    '/api/v1/internal/usage/reset',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      let period = currentPeriodStart();

      if (body.period_start !== undefined) {
        if (typeof body.period_start !== 'string' || !PERIOD_RE.test(body.period_start)) {
          throw new ValidationError('period_start must be a string in YYYY-MM-01 format');
        }
        period = body.period_start;
      }

      const result = await usageService.reset(request.tenantId, period);
      return reply.send({ success: true, data: { deleted: result.deleted, period_start: period } });
    },
  );

  // ── POST /api/v1/internal/usage/overrides ─────────────────────────────────
  //
  // Upserts a per-tenant limit override.
  // limit_value null = explicitly unlimited (beats any plan limit).
  //
  // Body: { "feature_key": "voice.callback", "limit_type": "tool_calls_per_month", "limit_value": 10 }
  // limit_type defaults to the standard bucket when omitted.

  app.post(
    '/api/v1/internal/usage/overrides',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (typeof body.feature_key !== 'string' || !body.feature_key.trim()) {
        throw new ValidationError('Body must contain a non-empty "feature_key" string');
      }

      const featureKey = body.feature_key.trim();
      const limitType  = typeof body.limit_type === 'string' && body.limit_type.trim()
        ? body.limit_type.trim()
        : getLimitType(featureKey);

      let limitValue: number | null = null;
      if (body.limit_value !== undefined && body.limit_value !== null) {
        if (typeof body.limit_value !== 'number' || !Number.isInteger(body.limit_value) || body.limit_value < 0) {
          throw new ValidationError('"limit_value" must be a non-negative integer or null');
        }
        limitValue = body.limit_value as number;
      }

      await usageService.setOverride(request.tenantId, featureKey, limitType, limitValue);
      return reply.send({
        success: true,
        data: { feature_key: featureKey, limit_type: limitType, limit_value: limitValue },
      });
    },
  );

  // ── DELETE /api/v1/internal/usage/overrides ───────────────────────────────
  //
  // Removes a per-tenant limit override. After deletion the plan limit applies.
  //
  // Body: { "feature_key": "voice.callback", "limit_type": "tool_calls_per_month" }

  app.delete(
    '/api/v1/internal/usage/overrides',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (typeof body.feature_key !== 'string' || !body.feature_key.trim()) {
        throw new ValidationError('Body must contain a non-empty "feature_key" string');
      }

      const featureKey = body.feature_key.trim();
      const limitType  = typeof body.limit_type === 'string' && body.limit_type.trim()
        ? body.limit_type.trim()
        : getLimitType(featureKey);

      await usageService.deleteOverride(request.tenantId, featureKey, limitType);
      return reply.send({ success: true, data: { feature_key: featureKey, limit_type: limitType } });
    },
  );
}
