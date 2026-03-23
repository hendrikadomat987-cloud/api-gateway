'use strict';


const axios = require('axios');
const config = require('../../config');
const logger = require('./logger');

// Headers that should not be forwarded upstream to avoid conflicts
const STRIP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',   // axios recalculates this
  'transfer-encoding',
]);

/**
 * Forwards an incoming Express request to the resolved n8n webhook URL.
 *
 * @param {object} options
 * @param {import('express').Request}  options.req         - Original Express request
 * @param {string}                     options.targetUrl   - Full n8n webhook URL
 * @param {object}                     [options.extraMeta] - Added to X-Gateway-Meta header
 * @returns {Promise<import('axios').AxiosResponse>}
 */
async function forwardRequest({ req, targetUrl, extraMeta = {} }) {
  // Build clean forward headers
  const forwardHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!STRIP_HEADERS.has(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  }

  // Gateway-injected headers
  forwardHeaders['X-Request-ID']    = req.id;
  forwardHeaders['X-Forwarded-For'] = req.ip;
  forwardHeaders['X-Gateway-Version'] = '1.0';

  if (config.n8n.webhookSecret) {
    forwardHeaders['X-Gateway-Token'] = config.n8n.webhookSecret;
  }

  // Pass decoded JWT claims downstream so n8n can use them directly
  if (req.jwtPayload) {
    forwardHeaders['X-User-ID']    = String(req.jwtPayload.sub || '');
    forwardHeaders['X-User-Roles'] = JSON.stringify(req.jwtPayload.roles || []);
  }

  // Append query string and optional :id to meta
  const meta = { ...extraMeta, query: req.query };
  forwardHeaders['X-Gateway-Meta'] = JSON.stringify(meta);

  // Route :id always wins — spread req.query first so extraMeta.id overrides any ?id= from client
  const queryParams = extraMeta.id
    ? { ...req.query, id: extraMeta.id }
    : req.query;

  logger.debug('Forwarding request', {
    method:      req.method,
    targetUrl,
    queryParams,
    id:          extraMeta.id   || null,
    service:     extraMeta.service || null,
    tenant:      extraMeta.tenant  || req.tenant_id || null,
    requestId:   req.id,
  });

  const startMs = Date.now();

  // Overwrite any client-supplied tenant_id with the trusted JWT value
  const safeBody = { ...req.body, tenant_id: req.tenant_id };

  const response = await axios({
    method:  req.method,
    url:     targetUrl,
    headers: forwardHeaders,
    data:    safeBody,
    params:  queryParams,
    timeout: config.n8n.timeoutMs,
    // Let the caller decide how to handle non-2xx status codes
    validateStatus: () => true,
  });

  const durationMs = Date.now() - startMs;
  const success    = response.status >= 200 && response.status < 300;

  logger.info('Upstream response', {
    targetUrl,
    status:    response.status,
    durationMs,
    success,
    requestId: req.id,
  });

  return response;
}

module.exports = { forwardRequest };
