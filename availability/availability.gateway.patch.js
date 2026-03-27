'use strict';

/**
 * availability.gateway.patch.js
 *
 * API Gateway integration patch for the availability service.
 *
 * HOW TO APPLY
 * ─────────────
 * 1. Ensure this entry exists in api-gateway/config.js → services:
 *
 *      availability: {
 *        POST:      'availability/create',
 *        GET:       'availability/list',
 *        GET_ID:    'availability/get',
 *        PUT_ID:    'availability/update',
 *        DELETE_ID: 'availability/delete',
 *      },
 *
 *    NOTE: Remove any legacy string entry for 'availability' — duplicate keys
 *    in a JS object cause the last one to win and override the method-keyed entry.
 *
 * 2. Ensure the POST and PUT validation blocks for "availability" are present
 *    in api-gateway/src/routes/apiRouter.js (see VALIDATION BLOCKS below).
 *    These blocks are already included in the current apiRouter.js.
 *
 * 3. Restart / redeploy the API Gateway after applying changes.
 *
 * SECURITY CONTRACT
 * ─────────────────
 * - tenant_id is NEVER trusted from the client body.
 * - tenant_id is extracted exclusively from the verified JWT payload.
 * - forwardRequest always overwrites req.body.tenant_id before forwarding.
 * - Any client-supplied tenant_id in the body is silently replaced.
 *
 * ROUTE MAPPING
 * ─────────────
 * Method   Gateway path                   → n8n webhook path
 * POST     /api/v1/availability           → /webhook/availability/create
 * GET      /api/v1/availability           → /webhook/availability/list
 * GET      /api/v1/availability/:id       → /webhook/availability/get   (?id=:id)
 * PUT      /api/v1/availability/:id       → /webhook/availability/update (?id=:id)
 * DELETE   /api/v1/availability/:id       → /webhook/availability/delete (?id=:id)
 *
 * SCHEMA
 * ──────
 * Fields:
 *   customer_id  uuid     required (POST only, immutable after creation)
 *   day_of_week  integer  required (0=Sunday … 6=Saturday)
 *   start_time   text     required (HH:MM format)
 *   end_time     text     required (HH:MM format)
 *   status       text     optional (active | inactive | blocked, default: active)
 */

// ─── Service registry entry ───────────────────────────────────────────────────
// Add to api-gateway/config.js → services (replaces any legacy string entry):

const SERVICE_REGISTRY_ENTRY = {
  availability: {
    POST:      'availability/create',
    GET:       'availability/list',
    GET_ID:    'availability/get',
    PUT_ID:    'availability/update',
    DELETE_ID: 'availability/delete',
  },
};

// ─── Validation blocks for apiRouter.js ──────────────────────────────────────
// These blocks are ALREADY PRESENT in api-gateway/src/routes/apiRouter.js.
// Reproduced here for documentation and diff review only.

/*

  // ── availability — POST validation ──────────────────────────────────────────
  if (req.method === 'POST' && service === 'availability') {
    const { customer_id, day_of_week, start_time, end_time, status } = req.body || {};
    req.body = {};
    if (customer_id !== undefined) req.body.customer_id = typeof customer_id === 'string' ? customer_id.trim() : customer_id;
    if (day_of_week  !== undefined) req.body.day_of_week = Number(day_of_week);
    if (start_time   !== undefined) req.body.start_time  = typeof start_time === 'string' ? start_time.trim() : start_time;
    if (end_time     !== undefined) req.body.end_time    = typeof end_time === 'string' ? end_time.trim() : end_time;
    if (status       !== undefined) req.body.status      = typeof status === 'string' ? status.trim().toLowerCase() : status;

    if (!req.body.customer_id) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'customer_id is required' } });
    }
    const UUID_RE_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE_LOCAL.test(req.body.customer_id)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'customer_id must be a valid UUID' } });
    }

    if (req.body.day_of_week === undefined) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'day_of_week is required' } });
    }
    if (!Number.isInteger(req.body.day_of_week) || req.body.day_of_week < 0 || req.body.day_of_week > 6) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'day_of_week must be an integer between 0 and 6' } });
    }

    if (!req.body.start_time) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'start_time is required' } });
    }
    if (!/^\d{2}:\d{2}$/.test(req.body.start_time)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'start_time must be in HH:MM format' } });
    }

    if (!req.body.end_time) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'end_time is required' } });
    }
    if (!/^\d{2}:\d{2}$/.test(req.body.end_time)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'end_time must be in HH:MM format' } });
    }

    const VALID_AVAILABILITY_STATUSES = ['active', 'inactive', 'blocked'];
    if (req.body.status !== undefined && !VALID_AVAILABILITY_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'status must be one of: active, inactive, blocked' } });
    }
  }

  // ── availability — PUT validation ─────────────────────────────────────────────
  if (req.method === 'PUT' && service === 'availability') {
    const { day_of_week, start_time, end_time, status } = req.body || {};
    req.body = {};
    if (day_of_week !== undefined) req.body.day_of_week = Number(day_of_week);
    if (start_time  !== undefined) req.body.start_time  = typeof start_time === 'string' ? start_time.trim() : start_time;
    if (end_time    !== undefined) req.body.end_time    = typeof end_time === 'string' ? end_time.trim() : end_time;
    if (status      !== undefined) req.body.status      = typeof status === 'string' ? status.trim().toLowerCase() : status;

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'At least one of day_of_week, start_time, end_time, or status is required' } });
    }

    if (req.body.day_of_week !== undefined) {
      if (!Number.isInteger(req.body.day_of_week) || req.body.day_of_week < 0 || req.body.day_of_week > 6) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'day_of_week must be an integer between 0 and 6' } });
      }
    }

    if (req.body.start_time !== undefined && !/^\d{2}:\d{2}$/.test(req.body.start_time)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'start_time must be in HH:MM format' } });
    }

    if (req.body.end_time !== undefined && !/^\d{2}:\d{2}$/.test(req.body.end_time)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'end_time must be in HH:MM format' } });
    }

    const VALID_AVAILABILITY_STATUSES = ['active', 'inactive', 'blocked'];
    if (req.body.status !== undefined && !VALID_AVAILABILITY_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'status must be one of: active, inactive, blocked' } });
    }
  }

*/

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { SERVICE_REGISTRY_ENTRY };
