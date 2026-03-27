'use strict';

/**
 * notifications.gateway.patch.js
 *
 * API Gateway integration patch for the notifications service.
 *
 * HOW TO APPLY
 * ─────────────
 * 1. Ensure this entry exists in api-gateway/config.js → services:
 *
 *      notifications: {
 *        POST:      'notifications/create',
 *        GET:       'notifications/list',
 *        GET_ID:    'notifications/get',
 *        PUT_ID:    'notifications/update',
 *        DELETE_ID: 'notifications/delete',
 *      },
 *
 * 2. Ensure the POST and PUT validation blocks for "notifications" are present
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
 * POST     /api/v1/notifications          → /webhook/notifications/create
 * GET      /api/v1/notifications          → /webhook/notifications/list
 * GET      /api/v1/notifications/:id      → /webhook/notifications/get   (?id=:id)
 * PUT      /api/v1/notifications/:id      → /webhook/notifications/update (?id=:id)
 * DELETE   /api/v1/notifications/:id      → /webhook/notifications/delete (?id=:id)
 *
 * SCHEMA
 * ──────
 * Fields:
 *   customer_id  uuid   required (POST only, immutable after creation)
 *   channel      text   required (email | sms | push)
 *   type         text   required (reminder | confirmation | cancellation | update)
 *   message      text   optional (notification body content)
 *   status       text   optional (pending | sent | failed, default: pending)
 */

// ─── Service registry entry ───────────────────────────────────────────────────
// Add to api-gateway/config.js → services:

const SERVICE_REGISTRY_ENTRY = {
  notifications: {
    POST:      'notifications/create',
    GET:       'notifications/list',
    GET_ID:    'notifications/get',
    PUT_ID:    'notifications/update',
    DELETE_ID: 'notifications/delete',
  },
};

// ─── Validation blocks for apiRouter.js ──────────────────────────────────────
// These blocks are ALREADY PRESENT in api-gateway/src/routes/apiRouter.js.
// Reproduced here for documentation and diff review only.

/*

  // ── notifications — POST validation ──────────────────────────────────────────
  if (req.method === 'POST' && service === 'notifications') {
    const { customer_id, channel, type, message, status } = req.body || {};
    req.body = {};
    if (customer_id !== undefined) req.body.customer_id = typeof customer_id === 'string' ? customer_id.trim() : customer_id;
    if (channel     !== undefined) req.body.channel     = typeof channel === 'string' ? channel.trim().toLowerCase() : channel;
    if (type        !== undefined) req.body.type        = typeof type === 'string' ? type.trim().toLowerCase() : type;
    if (message     !== undefined) req.body.message     = typeof message === 'string' ? message.trim() : message;
    if (status      !== undefined) req.body.status      = typeof status === 'string' ? status.trim().toLowerCase() : status;

    if (!req.body.customer_id) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'customer_id is required' } });
    }
    const UUID_RE_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE_LOCAL.test(req.body.customer_id)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'customer_id must be a valid UUID' } });
    }

    const VALID_CHANNELS = ['email', 'sms', 'push'];
    if (!req.body.channel) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'channel is required' } });
    }
    if (!VALID_CHANNELS.includes(req.body.channel)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'channel must be one of: email, sms, push' } });
    }

    const VALID_NOTIFICATION_TYPES = ['reminder', 'confirmation', 'cancellation', 'update'];
    if (!req.body.type) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type is required' } });
    }
    if (!VALID_NOTIFICATION_TYPES.includes(req.body.type)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type must be one of: reminder, confirmation, cancellation, update' } });
    }

    const VALID_NOTIFICATION_STATUSES = ['pending', 'sent', 'failed'];
    if (req.body.status !== undefined && !VALID_NOTIFICATION_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'status must be one of: pending, sent, failed' } });
    }
  }

  // ── notifications — PUT validation ────────────────────────────────────────────
  if (req.method === 'PUT' && service === 'notifications') {
    const { channel, type, message, status } = req.body || {};
    req.body = {};
    if (channel !== undefined) req.body.channel = typeof channel === 'string' ? channel.trim().toLowerCase() : channel;
    if (type    !== undefined) req.body.type    = typeof type === 'string' ? type.trim().toLowerCase() : type;
    if (message !== undefined) req.body.message = typeof message === 'string' ? message.trim() : message;
    if (status  !== undefined) req.body.status  = typeof status === 'string' ? status.trim().toLowerCase() : status;

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'At least one of channel, type, message, or status is required' } });
    }

    const VALID_CHANNELS = ['email', 'sms', 'push'];
    if (req.body.channel !== undefined && !VALID_CHANNELS.includes(req.body.channel)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'channel must be one of: email, sms, push' } });
    }

    const VALID_NOTIFICATION_TYPES = ['reminder', 'confirmation', 'cancellation', 'update'];
    if (req.body.type !== undefined && !VALID_NOTIFICATION_TYPES.includes(req.body.type)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type must be one of: reminder, confirmation, cancellation, update' } });
    }

    const VALID_NOTIFICATION_STATUSES = ['pending', 'sent', 'failed'];
    if (req.body.status !== undefined && !VALID_NOTIFICATION_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'status must be one of: pending, sent, failed' } });
    }
  }

*/

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { SERVICE_REGISTRY_ENTRY };
