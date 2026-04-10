// src/routes/admin.ts
//
// Phase 4B: Admin & Control Layer
//
// All routes are under /api/v1/internal/admin/ and require the ADMIN_TOKEN
// Bearer secret — NOT a tenant JWT.  The target tenant is always provided
// as a path parameter (:id) and validated as a UUID before use.
//
// Route summary:
//
//   Tenant registry
//     GET    /tenants                      — list all registered tenants
//     GET    /tenants/:id                  — tenant detail (plan, features, domains, usage)
//     POST   /tenants                      — register / upsert a tenant in the registry
//
//   Plan catalogue
//     GET    /plans                        — list all plans with domains, features, limits
//     GET    /plans/:key                   — single plan detail
//
//   Tenant management (acting on behalf of any tenant)
//     POST   /tenants/:id/plan             — assign a plan      { plan: "<key>" }
//     POST   /tenants/:id/features/enable  — enable a feature   { feature: "<key>" }
//     POST   /tenants/:id/features/disable — disable a feature  { feature: "<key>" }
//     POST   /tenants/:id/domains/enable   — enable a domain    { domain: "<key>" }
//     POST   /tenants/:id/domains/disable  — disable a domain   { domain: "<key>" }
//
//   Limits
//     GET    /tenants/:id/limits           — effective limits (override + plan)
//     POST   /tenants/:id/limits           — upsert override    { feature_key, limit_type?, limit_value }
//     DELETE /tenants/:id/limits           — remove override    { feature_key, limit_type? }
//
//   Usage
//     GET    /tenants/:id/usage            — current-period usage with limits
//     POST   /tenants/:id/usage/reset      — reset counters     { period_start? }
//
//   Billing (Phase 5A — read-only admin view)
//     GET    /tenants/:id/billing          — Stripe customer + subscription state
//
//   Insights (Phase 6 — observability)
//     GET    /tenants/:id/insights         — recent events, error rate, feature usage, limit hits

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { makeAdminAuth } from '../middleware/adminAuth.js';
import {
  listTenants,
  getTenantById,
  upsertTenant,
  listPlans,
  getPlanDetail,
  getTenantAdminDetail,
  getTenantLimits,
} from '../modules/admin/repositories/admin.repository.js';
import {
  assignPlanToTenant,
} from '../modules/features/repositories/plan.repository.js';
import {
  enableDomain,
  disableDomain,
  enableFeature,
  disableFeature,
} from '../modules/features/repositories/feature.repository.js';
import {
  setOverrideLimit,
  deleteOverrideLimit,
  resetUsage,
  currentPeriodStart,
} from '../modules/usage/repositories/usage.repository.js';
import { getLimitType } from '../modules/usage/services/usage.service.js';
import { NotFoundError, ValidationError } from '../errors/index.js';
import { getCustomer, getSubscriptionByTenant } from '../modules/billing/repositories/billing.repository.js';
import {
  getRecentEvents,
  getErrorRate,
  getTopFeatures,
  getLimitHits,
} from '../modules/observability/insights.repository.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD_RE = /^\d{4}-\d{2}-01$/;

function assertUuid(value: unknown, paramName: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ValidationError(`"${paramName}" must be a valid UUID`);
  }
  return value;
}

export async function adminRoutes(
  app: FastifyInstance,
  { adminToken }: { adminToken: string | undefined },
): Promise<void> {

  const preHandler = [makeAdminAuth(adminToken)];

  // ── GET /tenants ───────────────────────────────────────────────────────────

  app.get(
    '/api/v1/internal/admin/tenants',
    { preHandler },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const tenants = await listTenants();
      return reply.send({ success: true, data: { tenants } });
    },
  );

  // ── POST /tenants ──────────────────────────────────────────────────────────
  // Register or update a tenant in the registry.

  app.post(
    '/api/v1/internal/admin/tenants',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;

      const id   = assertUuid(body.id, 'id');
      if (typeof body.name !== 'string' || !body.name.trim()) {
        throw new ValidationError('"name" must be a non-empty string');
      }
      const name   = body.name.trim();
      const status = typeof body.status === 'string' ? body.status.trim() : 'active';
      if (!['active', 'inactive', 'suspended'].includes(status)) {
        throw new ValidationError('"status" must be one of: active, inactive, suspended');
      }

      const tenant = await upsertTenant(id, name, status);
      return reply.code(200).send({ success: true, data: { tenant } });
    },
  );

  // ── GET /tenants/:id ───────────────────────────────────────────────────────

  app.get(
    '/api/v1/internal/admin/tenants/:id',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = assertUuid((request.params as Record<string, unknown>).id, 'id');
      const detail = await getTenantAdminDetail(id);
      return reply.send({ success: true, data: detail });
    },
  );

  // ── GET /plans ─────────────────────────────────────────────────────────────

  app.get(
    '/api/v1/internal/admin/plans',
    { preHandler },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const plans = await listPlans();
      return reply.send({ success: true, data: { plans } });
    },
  );

  // ── GET /plans/:key ────────────────────────────────────────────────────────

  app.get(
    '/api/v1/internal/admin/plans/:key',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const key = (request.params as Record<string, unknown>).key;
      if (typeof key !== 'string' || !key.trim()) {
        throw new ValidationError('"key" path parameter is required');
      }
      const plan = await getPlanDetail(key.trim());
      if (!plan) throw new NotFoundError(`Plan '${key}' not found`, 'PLAN_NOT_FOUND');
      return reply.send({ success: true, data: { plan } });
    },
  );

  // ── POST /tenants/:id/plan ─────────────────────────────────────────────────

  app.post(
    '/api/v1/internal/admin/tenants/:id/plan',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = assertUuid((request.params as Record<string, unknown>).id, 'id');
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (typeof body.plan !== 'string' || !body.plan.trim()) {
        throw new ValidationError('"plan" must be a non-empty string');
      }
      const planKey = body.plan.trim();

      try {
        await assignPlanToTenant(tenantId, planKey);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Unknown plan")) {
          throw new NotFoundError(err.message, 'PLAN_NOT_FOUND');
        }
        throw err;
      }

      return reply.send({ success: true, data: { tenant_id: tenantId, plan: planKey } });
    },
  );

  // ── POST /tenants/:id/features/enable ─────────────────────────────────────

  app.post(
    '/api/v1/internal/admin/tenants/:id/features/enable',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = assertUuid((request.params as Record<string, unknown>).id, 'id');
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (typeof body.feature !== 'string' || !body.feature.trim()) {
        throw new ValidationError('"feature" must be a non-empty string');
      }
      const featureKey = body.feature.trim();

      try {
        await enableFeature(tenantId, featureKey);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Unknown feature")) {
          throw new NotFoundError(err.message, 'FEATURE_NOT_FOUND');
        }
        throw err;
      }

      return reply.send({ success: true, data: { tenant_id: tenantId, feature: featureKey, enabled: true } });
    },
  );

  // ── POST /tenants/:id/features/disable ────────────────────────────────────

  app.post(
    '/api/v1/internal/admin/tenants/:id/features/disable',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = assertUuid((request.params as Record<string, unknown>).id, 'id');
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (typeof body.feature !== 'string' || !body.feature.trim()) {
        throw new ValidationError('"feature" must be a non-empty string');
      }
      const featureKey = body.feature.trim();

      try {
        await disableFeature(tenantId, featureKey);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Unknown feature")) {
          throw new NotFoundError(err.message, 'FEATURE_NOT_FOUND');
        }
        throw err;
      }

      return reply.send({ success: true, data: { tenant_id: tenantId, feature: featureKey, enabled: false } });
    },
  );

  // ── POST /tenants/:id/domains/enable ──────────────────────────────────────

  app.post(
    '/api/v1/internal/admin/tenants/:id/domains/enable',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = assertUuid((request.params as Record<string, unknown>).id, 'id');
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (typeof body.domain !== 'string' || !body.domain.trim()) {
        throw new ValidationError('"domain" must be a non-empty string');
      }
      const domainKey = body.domain.trim();

      try {
        await enableDomain(tenantId, domainKey);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Unknown domain")) {
          throw new NotFoundError(err.message, 'DOMAIN_NOT_FOUND');
        }
        throw err;
      }

      return reply.send({ success: true, data: { tenant_id: tenantId, domain: domainKey, enabled: true } });
    },
  );

  // ── POST /tenants/:id/domains/disable ─────────────────────────────────────

  app.post(
    '/api/v1/internal/admin/tenants/:id/domains/disable',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = assertUuid((request.params as Record<string, unknown>).id, 'id');
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (typeof body.domain !== 'string' || !body.domain.trim()) {
        throw new ValidationError('"domain" must be a non-empty string');
      }
      const domainKey = body.domain.trim();

      try {
        await disableDomain(tenantId, domainKey);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Unknown domain")) {
          throw new NotFoundError(err.message, 'DOMAIN_NOT_FOUND');
        }
        throw err;
      }

      return reply.send({ success: true, data: { tenant_id: tenantId, domain: domainKey, enabled: false } });
    },
  );

  // ── GET /tenants/:id/limits ───────────────────────────────────────────────

  app.get(
    '/api/v1/internal/admin/tenants/:id/limits',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = assertUuid((request.params as Record<string, unknown>).id, 'id');
      const limits = await getTenantLimits(tenantId);
      return reply.send({ success: true, data: { tenant_id: tenantId, limits } });
    },
  );

  // ── POST /tenants/:id/limits ──────────────────────────────────────────────
  // Upsert a tenant limit override.

  app.post(
    '/api/v1/internal/admin/tenants/:id/limits',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = assertUuid((request.params as Record<string, unknown>).id, 'id');
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (typeof body.feature_key !== 'string' || !body.feature_key.trim()) {
        throw new ValidationError('"feature_key" must be a non-empty string');
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

      await setOverrideLimit(tenantId, featureKey, limitType, limitValue);
      return reply.send({
        success: true,
        data: { tenant_id: tenantId, feature_key: featureKey, limit_type: limitType, limit_value: limitValue },
      });
    },
  );

  // ── DELETE /tenants/:id/limits ────────────────────────────────────────────
  // Remove a tenant limit override.

  app.delete(
    '/api/v1/internal/admin/tenants/:id/limits',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = assertUuid((request.params as Record<string, unknown>).id, 'id');
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (typeof body.feature_key !== 'string' || !body.feature_key.trim()) {
        throw new ValidationError('"feature_key" must be a non-empty string');
      }
      const featureKey = body.feature_key.trim();
      const limitType  = typeof body.limit_type === 'string' && body.limit_type.trim()
        ? body.limit_type.trim()
        : getLimitType(featureKey);

      await deleteOverrideLimit(tenantId, featureKey, limitType);
      return reply.send({ success: true, data: { tenant_id: tenantId, feature_key: featureKey, limit_type: limitType } });
    },
  );

  // ── GET /tenants/:id/usage ────────────────────────────────────────────────

  app.get(
    '/api/v1/internal/admin/tenants/:id/usage',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = assertUuid((request.params as Record<string, unknown>).id, 'id');
      const detail = await getTenantAdminDetail(tenantId);
      return reply.send({
        success: true,
        data: {
          tenant_id: tenantId,
          plan:      detail.plan,
          usage:     detail.usage,
        },
      });
    },
  );

  // ── GET /tenants/:id/billing ──────────────────────────────────────────────
  // Returns billing customer and subscription state for the tenant.

  app.get(
    '/api/v1/internal/admin/tenants/:id/billing',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = assertUuid((request.params as Record<string, unknown>).id, 'id');
      const [customer, subscription] = await Promise.all([
        getCustomer(tenantId),
        getSubscriptionByTenant(tenantId),
      ]);
      return reply.send({
        success: true,
        data: {
          tenant_id:              tenantId,
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

  // ── GET /tenants/:id/insights ────────────────────────────────────────────
  // Returns observability insights: recent runtime events, error rate (24h),
  // most-used features, and limit-hit counts.

  app.get(
    '/api/v1/internal/admin/tenants/:id/insights',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = assertUuid((request.params as Record<string, unknown>).id, 'id');
      const [events, errorRate, topFeatures, limitHits] = await Promise.all([
        getRecentEvents(tenantId),
        getErrorRate(tenantId),
        getTopFeatures(tenantId),
        getLimitHits(tenantId),
      ]);
      return reply.send({
        success: true,
        data: {
          tenant_id:    tenantId,
          recent_events: events,
          error_rate:   errorRate,
          top_features: topFeatures,
          limit_hits:   limitHits,
        },
      });
    },
  );

  // ── POST /tenants/:id/usage/reset ─────────────────────────────────────────

  app.post(
    '/api/v1/internal/admin/tenants/:id/usage/reset',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = assertUuid((request.params as Record<string, unknown>).id, 'id');
      const body = (request.body ?? {}) as Record<string, unknown>;

      let period = currentPeriodStart();
      if (body.period_start !== undefined) {
        if (typeof body.period_start !== 'string' || !PERIOD_RE.test(body.period_start)) {
          throw new ValidationError('"period_start" must be a string in YYYY-MM-01 format');
        }
        period = body.period_start;
      }

      const result = await resetUsage(tenantId, period);
      return reply.send({ success: true, data: { tenant_id: tenantId, deleted: result.deleted, period_start: period } });
    },
  );
}
