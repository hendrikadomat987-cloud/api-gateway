// src/routes/features-internal.ts
//
// Feature System V2 — internal management endpoints.
// All routes require a valid JWT with tenant context.
//
// Routes:
//   POST /internal/features/domains/enable   { "domain": "<key>" }
//   POST /internal/features/domains/disable  { "domain": "<key>" }
//   POST /internal/features/features/enable  { "feature": "<key>" }
//   POST /internal/features/features/disable { "feature": "<key>" }

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { resolveTenantContext } from '../middleware/tenantContext.js';
import { featureService } from '../modules/features/services/feature.service.js';
import { ValidationError, NotFoundError } from '../errors/index.js';

const preHandler = [authenticate, resolveTenantContext];

export async function featuresInternalRoutes(app: FastifyInstance): Promise<void> {
  // ── Domain enable ──────────────────────────────────────────────────────────

  app.post(
    '/internal/features/domains/enable',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { domain } = request.body as Record<string, unknown>;
      if (typeof domain !== 'string' || !domain.trim()) {
        throw new ValidationError('Body must contain a non-empty "domain" string');
      }

      try {
        await featureService.enableDomain(request.tenantId, domain.trim());
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Unknown domain")) {
          throw new NotFoundError(err.message, 'DOMAIN_NOT_FOUND');
        }
        throw err;
      }

      return reply.send({ success: true, data: { domain: domain.trim(), enabled: true } });
    },
  );

  // ── Domain disable ─────────────────────────────────────────────────────────

  app.post(
    '/internal/features/domains/disable',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { domain } = request.body as Record<string, unknown>;
      if (typeof domain !== 'string' || !domain.trim()) {
        throw new ValidationError('Body must contain a non-empty "domain" string');
      }

      try {
        await featureService.disableDomain(request.tenantId, domain.trim());
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Unknown domain")) {
          throw new NotFoundError(err.message, 'DOMAIN_NOT_FOUND');
        }
        throw err;
      }

      return reply.send({ success: true, data: { domain: domain.trim(), enabled: false } });
    },
  );

  // ── Feature enable ─────────────────────────────────────────────────────────

  app.post(
    '/internal/features/features/enable',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { feature } = request.body as Record<string, unknown>;
      if (typeof feature !== 'string' || !feature.trim()) {
        throw new ValidationError('Body must contain a non-empty "feature" string');
      }

      try {
        await featureService.enableFeature(request.tenantId, feature.trim());
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Unknown feature")) {
          throw new NotFoundError(err.message, 'FEATURE_NOT_FOUND');
        }
        throw err;
      }

      return reply.send({ success: true, data: { feature: feature.trim(), enabled: true } });
    },
  );

  // ── Feature disable ────────────────────────────────────────────────────────

  app.post(
    '/internal/features/features/disable',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { feature } = request.body as Record<string, unknown>;
      if (typeof feature !== 'string' || !feature.trim()) {
        throw new ValidationError('Body must contain a non-empty "feature" string');
      }

      try {
        await featureService.disableFeature(request.tenantId, feature.trim());
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Unknown feature")) {
          throw new NotFoundError(err.message, 'FEATURE_NOT_FOUND');
        }
        throw err;
      }

      return reply.send({ success: true, data: { feature: feature.trim(), enabled: false } });
    },
  );
}
