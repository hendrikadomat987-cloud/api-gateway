'use strict';

const logger = require('../utils/logger');

/**
 * Tenant context middleware — must run after authMiddleware.
 *
 * Derives req.tenant_id exclusively from the verified JWT payload.
 * The x-tenant-id header is accepted only as a consistency check —
 * it is never trusted as the authoritative source.
 *
 * 401 — JWT has no organization_id claim
 * 403 — x-tenant-id header present but does not match JWT tenant
 */
function tenantContext(req, res, next) {
  const organization_id = req.jwtPayload && req.jwtPayload.organization_id;

  if (!organization_id) {
    logger.warn('Tenant context missing: organization_id absent from JWT', {
      requestId: req.id,
    });
    return res.status(401).json(error('MISSING_TENANT', 'Token does not contain organization_id'));
  }

  const headerTenant = req.headers['x-tenant-id'];
  if (headerTenant !== undefined && headerTenant !== organization_id) {
    logger.warn('TENANT_MISMATCH', {
      event:           'security_violation',
      type:            'tenant_mismatch',
      requestId:       req.id,
      tenantFromToken: organization_id,
      tenantFromHeader: headerTenant,
      path:            req.originalUrl,
      method:          req.method,
      ip:              req.ip,
      userAgent:       req.headers['user-agent'],
    });
    return res.status(403).json(error('TENANT_MISMATCH', 'x-tenant-id does not match token tenant'));
  }

  req.tenant_id     = organization_id;
  req.tenant_source = 'jwt';
  next();
}

function error(code, message) {
  return { success: false, error: { code, message } };
}

module.exports = tenantContext;
