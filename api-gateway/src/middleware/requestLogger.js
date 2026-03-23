'use strict';

const morgan = require('morgan');
const logger = require('../utils/logger');

// Pipe morgan output through winston so all logs stay in one stream.
const stream = {
  write: (message) => logger.http(message.trim()),
};

// Tokens
morgan.token('request-id', (req) => req.id || '-');
morgan.token('user-id',    (req) => (req.jwtPayload && req.jwtPayload.sub) || '-');

const format =
  ':method :url :status :res[content-length]B — :response-time ms ' +
  '| id=:request-id uid=:user-id';

const requestLogger = morgan(format, { stream });

module.exports = requestLogger;
