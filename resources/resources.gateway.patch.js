'use strict';

/**
 * resources.gateway.patch.js
 *
 * API Gateway integration patch for the resources service.
 *
 * HOW TO APPLY
 * ─────────────
 * 1. Add this entry to api-gateway/config.js → services:
 *
 *      resources: {
 *        POST:      'resources/create',
 *        GET:       'resources/list',
 *        GET_ID:    'resources/get',
 *        PUT_ID:    'resources/update',
 *        DELETE_ID: 'resources/delete',
 *      },
 *
 * 2. Add the POST and PUT validation blocks for "resources" to
 *    api-gateway/src/routes/apiRouter.js (see VALIDATION BLOCKS below).
 *
 * 3. Restart / redeploy the API Gateway after applying changes.
 *
 * SECURITY CONTRACT
 * ─────────────────
 * - tenant_id is NEVER trusted from the client body.
 * - tenant_id is extracted exclusively from the verified JWT payload.
 * - forwardRequest always overwrites req.body.tenant_id before forwarding.
 *
 * ROUTE MAPPING
 * ─────────────
 * Method   Gateway path               → n8n webhook path
 * POST     /api/v1/resources          → /webhook/resources/create
 * GET      /api/v1/resources          → /webhook/resources/list
 * GET      /api/v1/resources/:id      → /webhook/resources/get   (?id=:id)
 * PUT      /api/v1/resources/:id      → /webhook/resources/update (?id=:id)
 * DELETE   /api/v1/resources/:id      → /webhook/resources/delete (?id=:id)
 */

// ─── Service registry entry ───────────────────────────────────────────────────
// Add to api-gateway/config.js → services:

const SERVICE_REGISTRY_ENTRY = {
  resources: {
    POST:      'resources/create',
    GET:       'resources/list',
    GET_ID:    'resources/get',
    PUT_ID:    'resources/update',
    DELETE_ID: 'resources/delete',
  },
};

// ─── Validation blocks for apiRouter.js ──────────────────────────────────────
// Insert these blocks in api-gateway/src/routes/apiRouter.js inside the
// protectedRouter.all handler, after the requests validation blocks.

/*

  // ── resources — POST validation ───────────────────────────────────────────
  if (req.method === 'POST' && service === 'resources') {
    const { name, type, content, status } = req.body || {};
    req.body = {};
    if (name    !== undefined) req.body.name    = typeof name === 'string' ? name.trim() : name;
    if (type    !== undefined) req.body.type    = typeof type === 'string' ? type.trim().toLowerCase() : type;
    if (content !== undefined) req.body.content = typeof content === 'string' ? content.trim() : content;
    if (status  !== undefined) req.body.status  = typeof status === 'string' ? status.trim().toLowerCase() : status;

    if (!req.body.name || req.body.name === '') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
    }

    const VALID_RESOURCE_TYPES = ['document', 'template', 'script', 'faq'];
    if (!req.body.type) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type is required' } });
    }
    if (!VALID_RESOURCE_TYPES.includes(req.body.type)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type must be one of: document, template, script, faq' } });
    }

    const VALID_RESOURCE_STATUSES = ['active', 'draft', 'archived'];
    if (req.body.status !== undefined && !VALID_RESOURCE_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'status must be one of: active, draft, archived' } });
    }
  }

  // ── resources — PUT validation ────────────────────────────────────────────
  if (req.method === 'PUT' && service === 'resources') {
    const { name, type, content, status } = req.body || {};
    req.body = {};
    if (name    !== undefined) req.body.name    = typeof name === 'string' ? name.trim() : name;
    if (type    !== undefined) req.body.type    = typeof type === 'string' ? type.trim().toLowerCase() : type;
    if (content !== undefined) req.body.content = typeof content === 'string' ? content.trim() : content;
    if (status  !== undefined) req.body.status  = typeof status === 'string' ? status.trim().toLowerCase() : status;

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'At least one of name, type, content, or status is required' } });
    }

    if (req.body.name !== undefined && req.body.name === '') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name must not be empty' } });
    }

    const VALID_RESOURCE_TYPES = ['document', 'template', 'script', 'faq'];
    if (req.body.type !== undefined && !VALID_RESOURCE_TYPES.includes(req.body.type)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type must be one of: document, template, script, faq' } });
    }

    const VALID_RESOURCE_STATUSES = ['active', 'draft', 'archived'];
    if (req.body.status !== undefined && !VALID_RESOURCE_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'status must be one of: active, draft, archived' } });
    }
  }

*/

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { SERVICE_REGISTRY_ENTRY };
