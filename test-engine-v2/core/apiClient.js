'use strict';

const axios  = require('axios');
const config = require('../config/config');
const logger = require('./logger');

// ── Retry helper ──────────────────────────────────────────────────────────────

const RETRIABLE_CODES = new Set([
  'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'ECONNABORTED',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function on transient network errors with exponential back-off.
 *
 * @param {() => Promise<any>} fn
 * @param {number} maxAttempts
 * @param {number} baseDelayMs
 */
async function withRetry(fn, maxAttempts = config.retries, baseDelayMs = config.retryDelayMs) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isTransient = err.code && RETRIABLE_CODES.has(err.code);
      if (!isTransient || attempt >= maxAttempts) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      logger.warn(`Network error "${err.code}" — retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
      await sleep(delay);
    }
  }
  throw lastError;
}

// ── ApiClient ─────────────────────────────────────────────────────────────────

class ApiClient {
  /**
   * @param {object}  [options]
   * @param {string}  [options.token]   - Bearer token ('' = no auth header)
   * @param {string}  [options.baseUrl] - Override base URL
   */
  constructor({ token, baseUrl } = {}) {
    this._token   = token !== undefined ? token : config.tokens.tenantA;
    this._baseUrl = baseUrl || config.baseUrl;
  }

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this._token) h['Authorization'] = `Bearer ${this._token}`;
    return h;
  }

  async _request(method, path, data, params) {
    const url = `${this._baseUrl}${path}`;
    logger.debug(`${method} ${url}`, data ? JSON.stringify(data) : '');

    const response = await withRetry(() =>
      axios({
        method,
        url,
        headers:        this._headers(),
        data,
        params,
        timeout:        config.timeoutMs,
        validateStatus: () => true,   // never throw on 4xx/5xx
      })
    );

    logger.debug(`→ ${response.status}`, JSON.stringify(response.data));
    return response;
  }

  get(path, params)     { return this._request('GET',    path, undefined, params); }
  post(path, data)      { return this._request('POST',   path, data); }
  put(path, data)       { return this._request('PUT',    path, data); }
  delete(path)          { return this._request('DELETE', path); }
}

/**
 * Factory — creates a pre-configured ApiClient.
 *
 * @param {object} [options]
 * @param {string} [options.token]   - Bearer token; pass '' for no auth
 * @param {string} [options.baseUrl]
 * @returns {ApiClient}
 */
function createClient(options = {}) {
  return new ApiClient(options);
}

// Default authenticated client (uses config.tokens.tenantA)
const defaultClient = createClient();

module.exports = { ApiClient, createClient, defaultClient };
