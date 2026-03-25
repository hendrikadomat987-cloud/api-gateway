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

    if (!req.body.email || req.body.email === '') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'email is required' },
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
