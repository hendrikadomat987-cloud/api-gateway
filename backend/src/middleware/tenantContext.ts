import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthError, ForbiddenError } from '../errors/index.js';

/**
 * Derives tenantId exclusively from the verified JWT's `organization_id` claim.
 *
 * Security contract:
 *   - tenant_id is NEVER read from body, query string, or path params.
 *   - If the caller sends x-tenant-id, it must match the JWT organization_id.
 *     A mismatch is a hard 403 — it indicates a misconfigured or spoofed client.
 *
 * Must run AFTER authenticate() (requires request.user to be populated).
 */
export async function resolveTenantContext(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const user = request.user;

  if (!user?.organization_id) {
    throw new AuthError('Token missing organization_id claim', 'MISSING_TENANT_CLAIM');
  }

  const jwtTenantId = user.organization_id;

  // Optional consistency check: x-tenant-id header must match JWT when provided
  const headerTenantId = request.headers['x-tenant-id'];
  if (typeof headerTenantId === 'string' && headerTenantId !== jwtTenantId) {
    throw new ForbiddenError(
      'x-tenant-id header does not match JWT organization_id',
      'TENANT_MISMATCH',
    );
  }

  request.tenantId = jwtTenantId;
}
