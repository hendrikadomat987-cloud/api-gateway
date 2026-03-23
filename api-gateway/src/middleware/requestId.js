'use strict';

const { randomUUID } = require('crypto');

/**
 * Attaches a unique request ID to every incoming request.
 * Uses X-Request-ID header if provided by the caller, otherwise generates one.
 * The same ID is echoed back in the response.
 */
function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
}

module.exports = requestId;
