'use strict';

/**
 * status.gateway.patch.js
 *
 * API Gateway integration patch for the status service.
 *
 * HOW TO APPLY
 * ─────────────
 * 1. Add this entry to api-gateway/config.js → services:
 *
 *    status: {
 *      POST:      'status/create',   // POST   /api/v1/status
 *      GET:       'status/list',     // GET    /api/v1/status
 *      GET_ID:    'status/get',      // GET    /api/v1/status/:id
 *      PUT_ID:    'status/update',   // PUT    /api/v1/status/:id
 *      DELETE_ID: 'status/delete',   // DELETE /api/v1/status/:id
 *    },
 *
 * 2. Add the validation blocks from VALIDATION BLOCKS section below to
 *    api-gateway/src/routes/apiRouter.js before the final serviceMap.resolve() call.
 *
 * 3. Restart the API gateway.
 */

// ── Schema ──────────────────────────────────────────────────────────────────
//
// Service:  status
// Table:    public.status
// Fields:
//   id          uuid        PK
//   tenant_id   uuid        NOT NULL (RLS)
//   name        text        NOT NULL
//   type        text        NOT NULL  — agent | service | system | resource
//   value       text        NOT NULL  — online | offline | busy | available | unknown
//   description text        optional
//   created_at  timestamptz
//   updated_at  timestamptz

// ── SERVICE REGISTRY ENTRY (config.js) ──────────────────────────────────────
const SERVICE_REGISTRY_ENTRY = {
  status: {
    POST:      'status/create',
    GET:       'status/list',
    GET_ID:    'status/get',
    PUT_ID:    'status/update',
    DELETE_ID: 'status/delete',
  },
};

// ── VALIDATION BLOCKS (apiRouter.js) ────────────────────────────────────────
//
// Paste these two blocks into apiRouter.js before the serviceMap.resolve() call.

/*
  // ── status — POST validation ──────────────────────────────────────────────
  if (req.method === 'POST' && service === 'status') {
    const { name, type, value, description } = req.body || {};
    req.body = {};
    if (name        !== undefined) req.body.name        = typeof name === 'string' ? name.trim() : name;
    if (type        !== undefined) req.body.type        = typeof type === 'string' ? type.trim().toLowerCase() : type;
    if (value       !== undefined) req.body.value       = typeof value === 'string' ? value.trim().toLowerCase() : value;
    if (description !== undefined) req.body.description = typeof description === 'string' ? description.trim() : description;

    if (!req.body.name || req.body.name === '') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
    }
    const VALID_STATUS_TYPES = ['agent', 'service', 'system', 'resource'];
    if (!req.body.type) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type is required' } });
    }
    if (!VALID_STATUS_TYPES.includes(req.body.type)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type must be one of: agent, service, system, resource' } });
    }
    const VALID_STATUS_VALUES = ['online', 'offline', 'busy', 'available', 'unknown'];
    if (req.body.value !== undefined && !VALID_STATUS_VALUES.includes(req.body.value)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'value must be one of: online, offline, busy, available, unknown' } });
    }
  }

  // ── status — PUT validation ──────────────────────────────────────────────
  if (req.method === 'PUT' && service === 'status') {
    const { name, type, value, description } = req.body || {};
    req.body = {};
    if (name        !== undefined) req.body.name        = typeof name === 'string' ? name.trim() : name;
    if (type        !== undefined) req.body.type        = typeof type === 'string' ? type.trim().toLowerCase() : type;
    if (value       !== undefined) req.body.value       = typeof value === 'string' ? value.trim().toLowerCase() : value;
    if (description !== undefined) req.body.description = typeof description === 'string' ? description.trim() : description;

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'At least one of name, type, value, or description is required' } });
    }
    const VALID_STATUS_TYPES = ['agent', 'service', 'system', 'resource'];
    if (req.body.type !== undefined && !VALID_STATUS_TYPES.includes(req.body.type)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type must be one of: agent, service, system, resource' } });
    }
    const VALID_STATUS_VALUES = ['online', 'offline', 'busy', 'available', 'unknown'];
    if (req.body.value !== undefined && !VALID_STATUS_VALUES.includes(req.body.value)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'value must be one of: online, offline, busy, available, unknown' } });
    }
  }
*/

module.exports = { SERVICE_REGISTRY_ENTRY };
