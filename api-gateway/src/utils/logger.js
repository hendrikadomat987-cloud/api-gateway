'use strict';

const { createLogger, format, transports } = require('winston');
const config = require('../../config');

const { combine, timestamp, printf, colorize, errors } = format;

// ── Pretty format for development ─────────────────────────────────────────
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const extras = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${stack || message}${extras}`;
  })
);

// ── JSON format for production ─────────────────────────────────────────────
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  format.json()
);

const logger = createLogger({
  level: config.logging.level,
  format: config.server.env === 'production' ? prodFormat : devFormat,
  transports: [new transports.Console()],
  exitOnError: false,
});

module.exports = logger;
