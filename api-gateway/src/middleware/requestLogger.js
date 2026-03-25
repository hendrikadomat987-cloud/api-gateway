'use strict';

const morgan = require('morgan');
const logger = require('../utils/logger');

// Pipe morgan output through winston so all logs stay in one stream.
const stream = {
  write: (message) => logger.http(message.trim()),
};

// Tokens
morgan.token('request-id',    (req) => req.id || '-');
morgan.token('user-id',       (req) => (req.jwtPayload && req.jwtPayload.sub) || '-');
morgan.token('tenant-source', (req) => req.tenant_source || '-');
// Log only the first 8 chars of tenant_id — enough for correlation, not a full leak
morgan.token('tenant-id',     (req) => {
  const tid = req.tenant_id;
  if (!tid) return '-';
  return tid.length > 8 ? `${tid.substring(0, 8)}…` : tid;
});

const format =
  ':method :url :status :res[content-length]B — :response-time ms ' +
  '| id=:request-id uid=:user-id tenant=:tenant-id src=:tenant-source';

const requestLogger = morgan(format, { stream });

module.exports = requestLogger;
