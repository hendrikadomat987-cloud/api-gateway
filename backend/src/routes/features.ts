// src/routes/features.ts
//
// Feature System V1 — tenant-scoped read endpoints.
// No write operations in Phase 1 (provisioning is seeded / service-internal).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { resolveTenantContext } from '../middleware/tenantContext.js';
import { featureService } from '../modules/features/services/feature.service.js';

const preHandler = [authenticate, resolveTenantContext];

export async function featureRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/features
   *
   * Returns the enabled features and domains for the calling tenant.
   * Uses the feature service cache (60 s TTL).
   *
   * Response:
   *   { success: true, data: { features: string[], domains: string[] } }
   */
  app.get('/api/v1/features', { preHandler }, async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const tenantId = request.tenantId;

    // Sequential — not parallel. getTenantFeatures populates the in-process cache
    // (features + domains together). The getTenantDomains call then returns from
    // cache without a second DB round-trip. Using Promise.all here would fire
    // 4 DB queries on cache-miss (both functions each fetch features AND domains
    // internally) instead of 2.
    const features = await featureService.getTenantFeatures(tenantId);
    const domains  = await featureService.getTenantDomains(tenantId);

    return reply.send({
      success: true,
      data: { features, domains },
    });
  });
}
