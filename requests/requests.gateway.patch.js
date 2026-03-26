'use strict';

/**
 * requests.gateway.patch.js
 *
 * API Gateway integration patch for the requests service.
 *
 * HOW TO APPLY
 * ─────────────
 * 1. Ensure this entry exists in api-gateway/config.js → services:
 *
 *      requests: {
 *        POST:      'requests/create',
 *        GET:       'requests/list',
 *        GET_ID:    'requests/get',
 *        PUT_ID:    'requests/update',
 *        DELETE_ID: 'requests/delete',
 *      },
 *
 * 2. Ensure the POST and PUT validation blocks for "requests" are present
 *    in api-gateway/src/routes/apiRouter.js (see VALIDATION BLOCKS below).
 *
 * 3. Restart / redeploy the API Gateway after applying changes.
 *
 * SECURITY CONTRACT
 * ─────────────────
 * - tenant_id is NEVER trusted from the client body.
 * - tenant_id is extracted exclusively from the verified JWT payload
 *   (req.jwtPayload.organization_id or req.jwtPayload.tenant_id).
 * - forwardRequest always overwrites req.body.tenant_id before forwarding.
 * - Any client-supplied tenant_id in the body is silently replaced.
 *
 * ROUTE MAPPING
 * ─────────────
 * Method   Gateway path              → n8n webhook path
 * POST     /api/v1/requests          → /webhook/requests/create
 * GET      /api/v1/requests          → /webhook/requests/list
 * GET      /api/v1/requests/:id      → /webhook/requests/get   (?id=:id)
 * PUT      /api/v1/requests/:id      → /webhook/requests/update (?id=:id)
 * DELETE   /api/v1/requests/:id      → /webhook/requests/delete (?id=:id)
 */

// ─── Service registry entry ───────────────────────────────────────────────────
// Add to api-gateway/config.js → services:

const SERVICE_REGISTRY_ENTRY = {
  requests: {
    POST:      'requests/create',
    GET:       'requests/list',
    GET_ID:    'requests/get',
    PUT_ID:    'requests/update',
    DELETE_ID: 'requests/delete',
  },
};

// ─── Validation blocks for apiRouter.js ──────────────────────────────────────
// Insert these blocks in api-gateway/src/routes/apiRouter.js inside the
// protectedRouter.all handler, after the appointments validation blocks.

/*

  // ── requests — POST validation ────────────────────────────────────────────
  if (req.method === 'POST' && service === 'requests') {
    const { customer_id, type, status, notes } = req.body || {};
    req.body = {};
    if (customer_id !== undefined) req.body.customer_id = typeof customer_id === 'string' ? customer_id.trim() : customer_id;
    if (type        !== undefined) req.body.type        = typeof type === 'string' ? type.trim().toLowerCase() : type;
    if (status      !== undefined) req.body.status      = typeof status === 'string' ? status.trim().toLowerCase() : status;
    if (notes       !== undefined) req.body.notes       = typeof notes === 'string' ? notes.trim() : notes;

    if (!req.body.customer_id) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'customer_id is required' } });
    }
    const UUID_RE_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE_LOCAL.test(req.body.customer_id)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'customer_id must be a valid UUID' } });
    }

    const VALID_REQUEST_TYPES = ['callback', 'support', 'quote', 'info'];
    if (!req.body.type) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type is required' } });
    }
    if (!VALID_REQUEST_TYPES.includes(req.body.type)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type must be one of: callback, support, quote, info' } });
    }

    const VALID_REQUEST_STATUSES = ['pending', 'in_progress', 'resolved', 'closed'];
    if (req.body.status !== undefined && !VALID_REQUEST_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'status must be one of: pending, in_progress, resolved, closed' } });
    }
  }

  // ── requests — PUT validation ─────────────────────────────────────────────
  if (req.method === 'PUT' && service === 'requests') {
    const { type, status, notes } = req.body || {};
    req.body = {};
    if (type   !== undefined) req.body.type   = typeof type === 'string' ? type.trim().toLowerCase() : type;
    if (status !== undefined) req.body.status = typeof status === 'string' ? status.trim().toLowerCase() : status;
    if (notes  !== undefined) req.body.notes  = typeof notes === 'string' ? notes.trim() : notes;

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'At least one of type, status, or notes is required' } });
    }

    const VALID_REQUEST_TYPES = ['callback', 'support', 'quote', 'info'];
    if (req.body.type !== undefined && !VALID_REQUEST_TYPES.includes(req.body.type)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type must be one of: callback, support, quote, info' } });
    }

    const VALID_REQUEST_STATUSES = ['pending', 'in_progress', 'resolved', 'closed'];
    if (req.body.status !== undefined && !VALID_REQUEST_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'status must be one of: pending, in_progress, resolved, closed' } });
    }
  }

*/

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { SERVICE_REGISTRY_ENTRY };
