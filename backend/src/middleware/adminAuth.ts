// src/middleware/adminAuth.ts
//
// Admin API authentication middleware.
//
// Admin routes are protected by a static opaque token (ADMIN_TOKEN env var),
// not by tenant JWTs.  This keeps the admin surface completely separate from
// the tenant auth path and prevents any JWT from granting admin access.
//
// Behaviour:
//   • ADMIN_TOKEN not configured  → 503 Service Unavailable
//   • No Authorization header     → 401 Unauthorized
//   • Wrong token                 → 401 Unauthorized  (constant-time comparison)
//   • Correct token               → passes through (does NOT set request.tenantId)
//
// Admin routes receive the target tenant_id from URL path parameters only.

import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthError, AppError } from '../errors/index.js';

function extractBearer(request: FastifyRequest): string | null {
  const auth = request.headers['authorization'];
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

export function makeAdminAuth(adminToken: string | undefined) {
  return async function adminAuth(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    // Admin routes disabled when token is not configured
    if (!adminToken) {
      throw new AppError(503, 'ADMIN_DISABLED', 'Admin API is not configured on this server');
    }

    const provided = extractBearer(request);
    if (!provided) {
      throw new AuthError('Admin token required', 'UNAUTHORIZED');
    }

    // Constant-time comparison to prevent timing oracle attacks
    const expectedBuf = Buffer.from(adminToken, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');

    const match =
      expectedBuf.length === providedBuf.length &&
      timingSafeEqual(expectedBuf, providedBuf);

    if (!match) {
      throw new AuthError('Invalid admin token', 'UNAUTHORIZED');
    }
  };
}
