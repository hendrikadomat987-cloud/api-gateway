'use strict';

require('dotenv').config();

const express      = require('express');
const config       = require('./config');
const logger       = require('./src/utils/logger');
const requestId    = require('./src/middleware/requestId');
const requestLog   = require('./src/middleware/requestLogger');
const authenticate    = require('./src/middleware/auth');
const tenantContext   = require('./src/middleware/tenantContext');
const { publicRouter, protectedRouter } = require('./src/routes/apiRouter');
const { notFound, globalError }         = require('./src/middleware/errorHandler');

const app = express();

// ── Global middleware ──────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestId);
app.use(requestLog);
app.disable('x-powered-by');

// ── Public routes (no JWT) ─────────────────────────────────────────────────
// Liveness probe for container orchestrators
app.get('/ping', (req, res) => res.json({ ok: true }));

// /api/health  and  /api/services  — no auth required
app.use('/api', publicRouter);

// ── Protected routes (JWT required) ───────────────────────────────────────
// /api/:version/:service/:id?  — JWT must be present and valid
app.use('/api', authenticate, tenantContext, protectedRouter);

// ── 404 & global error handlers (must be last) ────────────────────────────
app.use(notFound);
app.use(globalError);

// ── Start ──────────────────────────────────────────────────────────────────
const server = app.listen(config.server.port, () => {
  logger.info('API Gateway started', {
    port: config.server.port,
    env:  config.server.env,
    n8n:  config.n8n.baseUrl,
  });
});

// Graceful shutdown
function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app; // exported for testing
