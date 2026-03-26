'use strict';

/**
 * appointments.gateway.patch.js
 *
 * API Gateway integration patch for the appointments service.
 *
 * HOW TO APPLY
 * ─────────────
 * 1. Add the service entry to api-gateway/config.js → services:
 *
 *      appointments: 'appointments_service',
 *
 * 2. In api-gateway/src/routes/apiRouter.js, mount the tenant-injection
 *    middleware for this service (see tenantInjectionMiddleware below).
 *    Alternatively, apply it globally so all services benefit.
 *
 * 3. Ensure n8n webhook base paths match:
 *      POST   /webhook/appointments/create
 *      GET    /webhook/appointments/list
 *      GET    /webhook/appointments/get    (with ?id=<uuid>)
 *      PUT    /webhook/appointments/update (with ?id=<uuid>)
 *      DELETE /webhook/appointments/delete (with ?id=<uuid>)
 *
 * SECURITY CONTRACT
 * ─────────────────
 * - tenant_id is NEVER trusted from the client body.
 * - tenant_id is extracted exclusively from the verified JWT payload
 *   (req.jwtPayload.organization_id or req.jwtPayload.tenant_id).
 * - The gateway overwrites req.body.tenant_id before forwarding.
 * - Any client-supplied tenant_id in the body is silently replaced.
 *
 * ROUTE MAPPING
 * ─────────────
 * Method   Gateway path                   → n8n webhook path
 * POST     /api/v1/appointments           → /webhook/appointments/create
 * GET      /api/v1/appointments           → /webhook/appointments/list
 * GET      /api/v1/appointments/:id       → /webhook/appointments/get   (?id=:id)
 * PUT      /api/v1/appointments/:id       → /webhook/appointments/update (?id=:id)
 * DELETE   /api/v1/appointments/:id       → /webhook/appointments/delete (?id=:id)
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Service configuration ────────────────────────────────────────────────────

/**
 * Add this entry to api-gateway/config.js → services object.
 *
 * services: {
 *   customer:      'customer_service',
 *   requests:      'requests_service',
 *   appointments:  'appointments_service',  // ← ADD THIS
 * }
 */
const SERVICE_REGISTRY_ENTRY = {
  appointments: 'appointments_service',
};

// ─── Tenant injection middleware ───────────────────────────────────────────────

/**
 * Extracts tenant_id from the verified JWT and writes it into req.body,
 * overwriting any client-provided value.
 *
 * Apply this middleware BEFORE forwardRequest for all protected routes,
 * or mount it specifically on the appointments router.
 *
 * The JWT must contain organization_id (preferred) or tenant_id.
 */
function tenantInjectionMiddleware(req, res, next) {
  const payload = req.jwtPayload;
  if (!payload) {
    return res.status(401).json({
      success: false,
      error: { code: 'MISSING_PAYLOAD', message: 'JWT payload is not available' },
    });
  }

  const tenantId = payload.organization_id || payload.tenant_id || null;
  if (!tenantId) {
    return res.status(403).json({
      success: false,
      error: { code: 'MISSING_TENANT', message: 'JWT does not contain organization_id or tenant_id' },
    });
  }

  // Overwrite — client body is never trusted
  req.body = req.body || {};
  req.body.tenant_id = tenantId;

  next();
}

// ─── UUID validation middleware ────────────────────────────────────────────────

/**
 * Validates :id path param as a UUID before forwarding.
 * Attach to all routes that accept an :id param.
 */
function validateIdParam(req, res, next) {
  const id = req.params.id;
  if (id && !UUID_RE.test(id)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_ID', message: 'id must be a valid UUID' },
    });
  }
  next();
}

// ─── Route definitions ────────────────────────────────────────────────────────

/**
 * Express router snippet for the appointments service.
 *
 * Copy this into api-gateway/src/routes/apiRouter.js inside the
 * protectedRouter setup, or as a standalone router mounted at /api/v1.
 *
 * Assumes:
 *   - authenticate middleware already ran (req.jwtPayload is set)
 *   - forwardRequest(webhookPath, req, res) proxies to n8n
 */

/*
const express = require('express');
const appointmentsRouter = express.Router();

// Inject tenant from JWT on every appointments route
appointmentsRouter.use(tenantInjectionMiddleware);

// POST /api/v1/appointments  → create
appointmentsRouter.post('/', (req, res) => {
  forwardRequest('appointments/create', req, res);
});

// GET /api/v1/appointments  → list
appointmentsRouter.get('/', (req, res) => {
  forwardRequest('appointments/list', req, res);
});

// GET /api/v1/appointments/:id  → get by id
appointmentsRouter.get('/:id', validateIdParam, (req, res) => {
  req.query.id = req.params.id;
  forwardRequest('appointments/get', req, res);
});

// PUT /api/v1/appointments/:id  → update
appointmentsRouter.put('/:id', validateIdParam, (req, res) => {
  req.query.id = req.params.id;
  forwardRequest('appointments/update', req, res);
});

// DELETE /api/v1/appointments/:id  → delete
appointmentsRouter.delete('/:id', validateIdParam, (req, res) => {
  req.query.id = req.params.id;
  forwardRequest('appointments/delete', req, res);
});

module.exports = appointmentsRouter;
*/

// ─── Exports (for testing / integration) ─────────────────────────────────────

module.exports = {
  SERVICE_REGISTRY_ENTRY,
  tenantInjectionMiddleware,
  validateIdParam,
};
