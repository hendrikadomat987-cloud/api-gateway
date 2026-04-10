// src/routes/features.ts
//
// Feature System — tenant-scoped read endpoints.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { resolveTenantContext } from '../middleware/tenantContext.js';
import { featureService } from '../modules/features/services/feature.service.js';

const preHandler = [authenticate, resolveTenantContext];

export async function featureRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/features
   *
   * Default: returns enabled feature keys and domain keys for the calling tenant.
   *   { success: true, data: { features: string[], domains: string[] } }
   *
   * ?verbose=true: returns full state including disabled entries.
   *   { success: true, data: {
   *       features: Array<{ key: string, enabled: boolean }>,
   *       domains:  Array<{ key: string, name: string, enabled: boolean }>
   *   }}
   *
   * The verbose response bypasses cache and reads current DB state.
   * The default response uses the 60 s in-process cache.
   */
  app.get(
    '/api/v1/features',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.tenantId;
      const verbose  = (request.query as Record<string, string>).verbose === 'true';

      if (verbose) {
        const [features, domains] = await Promise.all([
          featureService.getTenantFeaturesVerbose(tenantId),
          featureService.getTenantDomainsVerbose(tenantId),
        ]);
        return reply.send({ success: true, data: { features, domains } });
      }

      // Sequential — getTenantFeatures populates the cache (features + domains
      // together). getTenantDomains then returns from cache without a second
      // DB round-trip.
      const features = await featureService.getTenantFeatures(tenantId);
      const domains  = await featureService.getTenantDomains(tenantId);

      return reply.send({ success: true, data: { features, domains } });
    },
  );
}
