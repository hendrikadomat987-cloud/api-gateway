'use strict';

const config = require('../../config');
const logger = require('../utils/logger');

/**
 * Returns true when a service name is registered in config.services.
 *
 * @param {string} serviceName
 * @returns {boolean}
 */
function exists(serviceName) {
  return Object.prototype.hasOwnProperty.call(config.services, serviceName)
    && Boolean(config.services[serviceName]);
}

/**
 * Resolves a service name + HTTP method to its full n8n webhook URL.
 *
 * Supports two config shapes:
 *   - string  → single webhook for all methods (legacy services)
 *   - object  → method-keyed paths, e.g. { POST: 'customer/create', GET: 'customer/get' }
 *               Keys: METHOD (no :id) or METHOD_ID (with :id)
 *
 * @param {string}  serviceName - e.g. "customer"
 * @param {string}  method      - HTTP method, e.g. "GET", "POST"
 * @param {boolean} [hasId]     - true when the request includes an :id param
 * @param {string}  [id]        - the actual :id value (for logging only)
 * @returns {{ url: string, webhookPath: string } | null}
 */
function resolve(serviceName, method = 'GET', hasId = false, id = null) {
  // 🔥 FIX 1: Methode normalisieren
  method = (method || 'GET').toUpperCase();

  if (!exists(serviceName)) return null;

  const entry = config.services[serviceName];

  let webhookPath;

  if (typeof entry === 'string') {
    // Legacy: single webhook regardless of method
    webhookPath = entry;
  } else {
    if (hasId) {
      const idKey = `${method}_ID`;
      if (typeof entry[idKey] === 'string') {
        webhookPath = entry[idKey];
      } else if (typeof entry[method] === 'string') {
        logger.warn('Falling back from METHOD_ID to METHOD', {
          service: serviceName, method, idKey,
        });
        webhookPath = entry[method];
      } else {
        return null;
      }
    } else {
      webhookPath = typeof entry[method] === 'string' ? entry[method] : null;
      if (!webhookPath) return null;
    }
  }

  if (!webhookPath) return null;

  const url = `${config.n8n.baseUrl}/webhook/${webhookPath}`;

  logger.debug('Resolved service route', {
    service:     serviceName,
    method,
    hasId,
    id:          id || null,
    webhookPath,
    url,
  });

  return { webhookPath, url };
}

/**
 * Returns the list of all registered service names with their webhook mappings.
 * Used by the /api/services health endpoint.
 */
function listServices() {
  return Object.keys(config.services).map((name) => {
    const entry = config.services[name];

    if (typeof entry === 'string') {
      return {
        name,
        webhookPath: entry,
        url: `${config.n8n.baseUrl}/webhook/${entry}`,
      };
    }

    // Object entry — list each method mapping
    const routes = Object.fromEntries(
      Object.entries(entry).map(([key, path]) => [
        key,
        `${config.n8n.baseUrl}/webhook/${path}`,
      ])
    );

    return { name, routes };
  });
}

module.exports = { exists, resolve, listServices };