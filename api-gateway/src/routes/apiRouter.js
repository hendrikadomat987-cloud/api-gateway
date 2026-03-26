'use strict';

const { Router } = require('express');
const serviceMap     = require('../services/serviceMap');
const { forwardRequest } = require('../utils/forwardRequest');
const logger         = require('../utils/logger');

// ── Public router  (/api/health, /api/services) ───────────────────────────
const publicRouter = Router();

publicRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: serviceMap.listServices().map((s) => s.name),
  });
});

publicRouter.get('/services', (req, res) => {
  res.json({ success: true, data: serviceMap.listServices() });
});

// ── Protected router  (/api/:version/:service/:id?) ───────────────────────
const protectedRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

//   All HTTP methods forwarded as-is.
protectedRouter.all('/:version/:service/:id?', async (req, res, next) => {
  const { version, service, id } = req.params;

  // Validate version format  (v1, v2, …)
  if (!/^v\d+$/.test(version)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_VERSION',
        message: `Invalid API version "${version}". Expected format: v1, v2, …`,
      },
    });
  }

  // Validate :id format when present (must be a valid UUID)
  if (id && !UUID_RE.test(id)) {
    return res.status(400).json({
      success: false,
      error: {
        code:    'INVALID_ID',
        message: `Invalid ${service} ID format`,
      },
    });
  }

  // Reject query-param id bypass: ?id= must never substitute for or override :id
  const pathId  = id;
  const queryId = req.query.id;

  // Case 1: Query ID present without a path ID → reject
  if (!pathId && queryId) {
    return res.status(400).json({
      success: false,
      error: {
        code:    'INVALID_ID',
        message: 'Query parameter id is not allowed without path parameter',
      },
    });
  }

  // Case 2: Query ID present but mismatches path ID → reject
  if (queryId && queryId !== pathId) {
    return res.status(400).json({
      success: false,
      error: {
        code:    'INVALID_ID',
        message: 'Query parameter id must not override path parameter',
      },
    });
  }

  // Check service is registered at all — unknown service → 404
  if (!serviceMap.exists(service)) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'SERVICE_NOT_FOUND',
        message: `Unknown service "${service}"`,
      },
    });
  }

  // PUT and DELETE require an :id — reject early before attempting resolution
  if ((req.method === 'PUT' || req.method === 'DELETE') && !id) {
    return res.status(400).json({
      success: false,
      error: {
        code:    'MISSING_ID',
        message: `${req.method} requests to "${service}" require an :id parameter`,
      },
    });
  }

  if (req.method === 'POST' && service === 'customer') {
    // ── Sanitize: strip everything except allowed fields ──────────────────
    // tenant_id is intentionally excluded — forwardRequest re-injects it from JWT
    const { name, email, phone } = req.body || {};
    req.body = {};
    if (name  !== undefined) req.body.name  = typeof name  === 'string' ? name.trim()  : name;
    if (email !== undefined) req.body.email = typeof email === 'string' ? email.trim().toLowerCase() : email;
    if (phone !== undefined) req.body.phone = typeof phone === 'string' ? phone.trim() : phone;

    if (!req.body.name || req.body.name === '') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'name is required' },
      });
    }

    const hasEmail = req.body.email && req.body.email !== '';
    const hasPhone = req.body.phone && req.body.phone !== '';
    if (!hasEmail && !hasPhone) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'email or phone is required' },
      });
    }

    if (hasEmail && (!req.body.email.includes('@') || !req.body.email.includes('.'))) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid email format' },
      });
    }
  }

  if (req.method === 'PUT' && service === 'customer') {
    // ── Sanitize: strip everything except allowed fields and tenant_id ────────
    // tenant_id is removed here; forwardRequest will re-inject it from req.tenant_id
    const { name, phone, email } = req.body || {};
    req.body = {};
    if (name  !== undefined) req.body.name  = typeof name  === 'string' ? name.trim()  : name;
    if (phone !== undefined) req.body.phone = typeof phone === 'string' ? phone.trim() : phone;
    if (email !== undefined) req.body.email = typeof email === 'string' ? email.trim() : email;

    if (req.body.email) req.body.email = req.body.email.toLowerCase();

    // ── At least one field must be present ────────────────────────────────────
    const hasName  = req.body.name  !== undefined && String(req.body.name).trim()  !== '';
    const hasPhone = req.body.phone !== undefined && String(req.body.phone).trim() !== '';
    const hasEmail = req.body.email !== undefined && String(req.body.email).trim() !== '';

    if (!hasName && !hasPhone && !hasEmail) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one of name, phone, or email is required',
        },
      });
    }

    // ── Email format validation (when provided) ───────────────────────────────
    if (hasEmail && (!req.body.email.includes('@') || !req.body.email.includes('.'))) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid email format',
        },
      });
    }
  }

  // ── appointments — POST validation ──────────────────────────────────────────
  if (req.method === 'POST' && service === 'appointments') {
    // Whitelist: strip every field the client is not allowed to set.
    // tenant_id is excluded — forwardRequest re-injects it from req.tenant_id.
    const { customer_id, scheduled_at, duration_minutes, status, notes } = req.body || {};
    req.body = {};
    if (customer_id      !== undefined) req.body.customer_id      = typeof customer_id === 'string' ? customer_id.trim() : customer_id;
    if (scheduled_at     !== undefined) req.body.scheduled_at     = typeof scheduled_at === 'string' ? scheduled_at.trim() : scheduled_at;
    if (duration_minutes !== undefined) req.body.duration_minutes = Number(duration_minutes);
    if (status           !== undefined) req.body.status           = typeof status === 'string' ? status.trim().toLowerCase() : status;
    if (notes            !== undefined) req.body.notes            = typeof notes === 'string' ? notes.trim() : notes;

    // customer_id — required, must be a valid UUID
    if (!req.body.customer_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'customer_id is required' },
      });
    }
    if (!UUID_RE.test(req.body.customer_id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'customer_id must be a valid UUID' },
      });
    }

    // scheduled_at — required, must be a parseable ISO 8601 datetime
    if (!req.body.scheduled_at) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'scheduled_at is required' },
      });
    }
    if (isNaN(new Date(req.body.scheduled_at).getTime())) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'scheduled_at must be a valid ISO 8601 timestamp' },
      });
    }

    // duration_minutes — optional, must be an integer between 1 and 1440 when provided
    if (req.body.duration_minutes !== undefined) {
      const dm = req.body.duration_minutes;
      if (!Number.isInteger(dm) || dm < 1 || dm > 1440) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'duration_minutes must be an integer between 1 and 1440' },
        });
      }
    }
  }

  // ── appointments — PUT validation ───────────────────────────────────────────
  if (req.method === 'PUT' && service === 'appointments') {
    // Whitelist: customer_id cannot be changed after creation.
    // tenant_id excluded — forwardRequest re-injects it from req.tenant_id.
    const { scheduled_at, duration_minutes, status, notes } = req.body || {};
    req.body = {};
    if (scheduled_at     !== undefined) req.body.scheduled_at     = typeof scheduled_at === 'string' ? scheduled_at.trim() : scheduled_at;
    if (duration_minutes !== undefined) req.body.duration_minutes = Number(duration_minutes);
    if (status           !== undefined) req.body.status           = typeof status === 'string' ? status.trim().toLowerCase() : status;
    if (notes            !== undefined) req.body.notes            = typeof notes === 'string' ? notes.trim() : notes;

    // At least one updatable field must be present
    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one of scheduled_at, duration_minutes, status, or notes is required',
        },
      });
    }

    // scheduled_at format check when provided
    if (req.body.scheduled_at !== undefined && isNaN(new Date(req.body.scheduled_at).getTime())) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'scheduled_at must be a valid ISO 8601 timestamp' },
      });
    }

    // duration_minutes range check when provided
    if (req.body.duration_minutes !== undefined) {
      const dm = req.body.duration_minutes;
      if (!Number.isInteger(dm) || dm < 1 || dm > 1440) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'duration_minutes must be an integer between 1 and 1440' },
        });
      }
    }
  }

  // ── requests — POST validation ───────────────────────────────────────────────
  if (req.method === 'POST' && service === 'requests') {
    // Whitelist: strip every field the client is not allowed to set.
    // tenant_id is excluded — forwardRequest re-injects it from req.tenant_id.
    const { customer_id, type, status, notes } = req.body || {};
    req.body = {};
    if (customer_id !== undefined) req.body.customer_id = typeof customer_id === 'string' ? customer_id.trim() : customer_id;
    if (type        !== undefined) req.body.type        = typeof type === 'string' ? type.trim().toLowerCase() : type;
    if (status      !== undefined) req.body.status      = typeof status === 'string' ? status.trim().toLowerCase() : status;
    if (notes       !== undefined) req.body.notes       = typeof notes === 'string' ? notes.trim() : notes;

    // customer_id — required, must be a valid UUID
    if (!req.body.customer_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'customer_id is required' },
      });
    }
    if (!UUID_RE.test(req.body.customer_id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'customer_id must be a valid UUID' },
      });
    }

    // type — required, must be one of the allowed values
    const VALID_REQUEST_TYPES = ['callback', 'support', 'quote', 'info'];
    if (!req.body.type) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'type is required' },
      });
    }
    if (!VALID_REQUEST_TYPES.includes(req.body.type)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'type must be one of: callback, support, quote, info' },
      });
    }

    // status — optional, must be one of the allowed values when provided
    const VALID_REQUEST_STATUSES = ['pending', 'in_progress', 'resolved', 'closed'];
    if (req.body.status !== undefined && !VALID_REQUEST_STATUSES.includes(req.body.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'status must be one of: pending, in_progress, resolved, closed' },
      });
    }
  }

  // ── requests — PUT validation ────────────────────────────────────────────────
  if (req.method === 'PUT' && service === 'requests') {
    // Whitelist: customer_id cannot be changed after creation.
    // tenant_id excluded — forwardRequest re-injects it from req.tenant_id.
    const { type, status, notes } = req.body || {};
    req.body = {};
    if (type   !== undefined) req.body.type   = typeof type === 'string' ? type.trim().toLowerCase() : type;
    if (status !== undefined) req.body.status = typeof status === 'string' ? status.trim().toLowerCase() : status;
    if (notes  !== undefined) req.body.notes  = typeof notes === 'string' ? notes.trim() : notes;

    // At least one updatable field must be present
    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one of type, status, or notes is required',
        },
      });
    }

    // type — must be one of the allowed values when provided
    const VALID_REQUEST_TYPES = ['callback', 'support', 'quote', 'info'];
    if (req.body.type !== undefined && !VALID_REQUEST_TYPES.includes(req.body.type)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'type must be one of: callback, support, quote, info' },
      });
    }

    // status — must be one of the allowed values when provided
    const VALID_REQUEST_STATUSES = ['pending', 'in_progress', 'resolved', 'closed'];
    if (req.body.status !== undefined && !VALID_REQUEST_STATUSES.includes(req.body.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'status must be one of: pending, in_progress, resolved, closed' },
      });
    }
  }

  // ── resources — POST validation ──────────────────────────────────────────────
  if (req.method === 'POST' && service === 'resources') {
    // Whitelist: strip every field the client is not allowed to set.
    // tenant_id is excluded — forwardRequest re-injects it from req.tenant_id.
    const { name, type, content, status } = req.body || {};
    req.body = {};
    if (name    !== undefined) req.body.name    = typeof name === 'string' ? name.trim() : name;
    if (type    !== undefined) req.body.type    = typeof type === 'string' ? type.trim().toLowerCase() : type;
    if (content !== undefined) req.body.content = typeof content === 'string' ? content.trim() : content;
    if (status  !== undefined) req.body.status  = typeof status === 'string' ? status.trim().toLowerCase() : status;

    // name — required
    if (!req.body.name || req.body.name === '') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'name is required' },
      });
    }

    // type — required, must be one of the allowed values
    const VALID_RESOURCE_TYPES = ['document', 'template', 'script', 'faq'];
    if (!req.body.type) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'type is required' },
      });
    }
    if (!VALID_RESOURCE_TYPES.includes(req.body.type)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'type must be one of: document, template, script, faq' },
      });
    }

    // status — optional, must be one of the allowed values when provided
    const VALID_RESOURCE_STATUSES = ['active', 'draft', 'archived'];
    if (req.body.status !== undefined && !VALID_RESOURCE_STATUSES.includes(req.body.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'status must be one of: active, draft, archived' },
      });
    }
  }

  // ── resources — PUT validation ────────────────────────────────────────────────
  if (req.method === 'PUT' && service === 'resources') {
    // Whitelist: tenant_id excluded — forwardRequest re-injects it from req.tenant_id.
    const { name, type, content, status } = req.body || {};
    req.body = {};
    if (name    !== undefined) req.body.name    = typeof name === 'string' ? name.trim() : name;
    if (type    !== undefined) req.body.type    = typeof type === 'string' ? type.trim().toLowerCase() : type;
    if (content !== undefined) req.body.content = typeof content === 'string' ? content.trim() : content;
    if (status  !== undefined) req.body.status  = typeof status === 'string' ? status.trim().toLowerCase() : status;

    // At least one updatable field must be present
    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one of name, type, content, or status is required',
        },
      });
    }

    // name — must not be empty when provided
    if (req.body.name !== undefined && req.body.name === '') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'name must not be empty' },
      });
    }

    // type — must be one of the allowed values when provided
    const VALID_RESOURCE_TYPES = ['document', 'template', 'script', 'faq'];
    if (req.body.type !== undefined && !VALID_RESOURCE_TYPES.includes(req.body.type)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'type must be one of: document, template, script, faq' },
      });
    }

    // status — must be one of the allowed values when provided
    const VALID_RESOURCE_STATUSES = ['active', 'draft', 'archived'];
    if (req.body.status !== undefined && !VALID_RESOURCE_STATUSES.includes(req.body.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'status must be one of: active, draft, archived' },
      });
    }
  }

  // Resolve method + id → concrete n8n webhook URL
  // Returns null when the service exists but has no webhook for this method/id combo
  const resolved = serviceMap.resolve(service, req.method, Boolean(id), id || null);
  if (!resolved) {
    return res.status(405).json({
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: `Service "${service}" does not support ${req.method}${id ? ' with an :id' : ''}`,
      },
    });
  }

  logger.info('Routing request', {
    method: req.method,
    version,
    service,
    id: id || null,
    target: resolved.url,
    requestId: req.id,
  });

  if (req.params && req.params.id) {
    req.query = req.query || {};

    if (req.query.id && req.query.id !== req.params.id) {
      logger.warn('ID mismatch: query vs params', {
        queryId:   req.query.id,
        paramId:   req.params.id,
        requestId: req.id,
      });
    }

    req.query.id = req.params.id;
  }

  try {
    const upstream = await forwardRequest({
      req,
      targetUrl: resolved.url,
      extraMeta: { version, service, id: id || null },
    });

    res
      .status(upstream.status)
      .set(pickSafeHeaders(upstream.headers))
      .json(upstream.data);

  } catch (err) {
    next(err);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

const SAFE_RESPONSE_HEADERS = new Set([
  'content-type',
  'x-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'cache-control',
  'etag',
]);

function pickSafeHeaders(headers) {
  const safe = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase())) safe[key] = value;
  }
  return safe;
}

module.exports = { publicRouter, protectedRouter };
