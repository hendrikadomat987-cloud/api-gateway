'use strict';

/**
 * Minimal levelled logger.
 * Set LOG_LEVEL=debug|info|warn|error in .env (default: warn during tests).
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || 'warn'] ?? LEVELS.warn;

function log(level, ...args) {
  if (LEVELS[level] < currentLevel) return;
  const ts     = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase().padEnd(5)}]`;
  if (level === 'error') console.error(prefix, ...args);
  else if (level === 'warn')  console.warn(prefix, ...args);
  else console.log(prefix, ...args);
}

module.exports = {
  debug: (...a) => log('debug', ...a),
  info:  (...a) => log('info',  ...a),
  warn:  (...a) => log('warn',  ...a),
  error: (...a) => log('error', ...a),
};
