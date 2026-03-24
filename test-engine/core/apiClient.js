'use strict';

const axios  = require('axios');
const config = require('../config');

/**
 * Creates a pre-configured axios instance.
 *
 * @param {object} [options]
 * @param {string} [options.token]   - Bearer token. Omit to send no Authorization header.
 * @param {string} [options.baseUrl] - Override the default base URL from config.
 * @returns {import('axios').AxiosInstance}
 */
function createClient(options = {}) {
  const headers = { 'Content-Type': 'application/json' };

  if (options.token !== undefined) {
    // Allow callers to pass an empty string to explicitly omit the header
    if (options.token !== '') {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
  } else if (config.tokens.valid) {
    headers['Authorization'] = `Bearer ${config.tokens.valid}`;
  }

  return axios.create({
    baseURL:        options.baseUrl || config.baseUrl,
    headers,
    timeout:        config.timeoutMs,
    // Never throw on non-2xx — assertions handle status codes explicitly
    validateStatus: () => true,
  });
}

// Default authenticated client (uses config.tokens.valid)
const defaultClient = createClient();

module.exports = { createClient, defaultClient };
