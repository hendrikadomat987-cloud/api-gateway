'use strict';

const logger = require('../utils/logger');

/**
 * 404 handler — mount AFTER all routes.
 */
function notFound(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
  });
}

/**
 * Global error handler — must have 4 parameters so Express recognises it.
 * Mount LAST, after notFound.
 */
// eslint-disable-next-line no-unused-vars
function globalError(err, req, res, next) {
  // Attach request context to the log entry
  const meta = { requestId: req.id, url: req.originalUrl, method: req.method };

  // Axios upstream errors carry a response object
  if (err.isAxiosError) {
    const status  = err.response?.status || 502;
    const message = err.response?.data   || err.message;

    logger.warn('Upstream error from n8n', { ...meta, status, message });

    return res.status(status < 500 ? 502 : status).json({
      success: false,
      error: {
        code: 'UPSTREAM_ERROR',
        message: 'Error received from upstream service',
        upstream: { status, body: message },
      },
    });
  }

  // Operational errors (thrown intentionally with a statusCode)
  if (err.statusCode) {
    logger.warn('Operational error', { ...meta, statusCode: err.statusCode, message: err.message });
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code || 'ERROR', message: err.message },
    });
  }

  // Unexpected errors
  logger.error('Unhandled error', { ...meta, stack: err.stack });

  const isDev = process.env.NODE_ENV !== 'production';
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      ...(isDev && { detail: err.message, stack: err.stack }),
    },
  });
}

module.exports = { notFound, globalError };
