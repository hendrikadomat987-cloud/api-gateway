'use strict';

const { createHmac } = require('node:crypto');
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

  async _request(method, path, data, params, extraHeaders = {}) {
    const url = `${this._baseUrl}${path}`;
    logger.debug(`${method} ${url}`, data ? JSON.stringify(data) : '');

    const response = await withRetry(() =>
      axios({
        method,
        url,
        headers:        { ...this._headers(), ...extraHeaders },
        data,
        params,
        timeout:        config.timeoutMs,
        validateStatus: () => true,   // never throw on 4xx/5xx
      })
    );

    logger.debug(`→ ${response.status}`, JSON.stringify(response.data));
    return response;
  }

  get(path, params)               { return this._request('GET',    path, undefined, params); }
  post(path, data, extraHeaders)  { return this._request('POST',   path, data, undefined, extraHeaders); }
  put(path, data)                 { return this._request('PUT',    path, data); }
  delete(path)                    { return this._request('DELETE', path); }
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

// ── Voice API ─────────────────────────────────────────────────────────────────
//
// Public endpoint — no JWT required.
// Internal endpoints — JWT required (pass token explicitly).

/**
 * POST /voice/providers/vapi/webhook
 * Public endpoint — no Authorization header.
 * Signs the request body with HMAC-SHA256 using VAPI_WEBHOOK_SECRET.
 *
 * @param {object} message - VAPI webhook payload
 */
function sendVoiceWebhook(message) {
  const bodyStr = JSON.stringify(message);
  const secret  = process.env.VAPI_WEBHOOK_SECRET || '';
  const sig     = createHmac('sha256', secret).update(bodyStr).digest('hex');
  return createClient({ token: '' }).post(
    '/voice/providers/vapi/webhook',
    message,
    { 'x-vapi-signature': sig },
  );
}

/**
 * GET /voice/calls
 * @param {string} token
 */
function listVoiceCalls(token) {
  return createClient({ token }).get('/voice/calls');
}

/**
 * GET /voice/calls/:id
 * @param {string} token
 * @param {string} callId
 */
function getVoiceCall(token, callId) {
  return createClient({ token }).get(`/voice/calls/${callId}`);
}

/**
 * GET /voice/calls/:id/events
 * @param {string} token
 * @param {string} callId
 */
function getVoiceCallEvents(token, callId) {
  return createClient({ token }).get(`/voice/calls/${callId}/events`);
}

/**
 * GET /voice/calls/:id/session
 * Resolves the active session for a call by internal call UUID.
 * @param {string} token
 * @param {string} callId
 */
function getCallSession(token, callId) {
  return createClient({ token }).get(`/voice/calls/${callId}/session`);
}

/**
 * GET /voice/sessions/:id
 * @param {string} token
 * @param {string} sessionId
 */
function getVoiceSession(token, sessionId) {
  return createClient({ token }).get(`/voice/sessions/${sessionId}`);
}

/**
 * POST /voice/sessions/:id/fallback
 * @param {string} token
 * @param {string} sessionId
 * @param {object} [body]
 */
function postVoiceFallback(token, sessionId, body = {}) {
  return createClient({ token }).post(`/voice/sessions/${sessionId}/fallback`, body);
}

/**
 * POST /voice/sessions/:id/handover
 * @param {string} token
 * @param {string} sessionId
 * @param {object} [body]
 */
function postVoiceHandover(token, sessionId, body = {}) {
  return createClient({ token }).post(`/voice/sessions/${sessionId}/handover`, body);
}

/**
 * POST /voice/providers/vapi/webhook — with an explicit signature value.
 * Intended for signature-enforcement tests.
 *
 * Pass `null` to omit the x-vapi-signature header entirely (missing-signature case).
 * Pass any string to send that exact value (wrong-signature case or valid-signature case).
 *
 * @param {object} message  - VAPI webhook payload
 * @param {string|null} sig - signature string, or null to omit the header
 */
function sendVoiceWebhookSigned(message, sig) {
  const extraHeaders = sig !== null ? { 'x-vapi-signature': sig } : {};
  return createClient({ token: '' }).post(
    '/voice/providers/vapi/webhook',
    message,
    extraHeaders,
  );
}

/**
 * POST /voice/events/:id/retry
 * Triggers a manual replay of a failed voice event.
 *
 * @param {string} token
 * @param {string} eventId
 */
function retryVoiceEvent(token, eventId) {
  return createClient({ token }).post(`/voice/events/${eventId}/retry`, {});
}

/**
 * GET /api/v1/features
 * Returns enabled features and domains for the calling tenant.
 *
 * @param {string} token
 */
function getTenantFeatures(token) {
  return createClient({ token }).get('/api/v1/features');
}

/**
 * GET /api/v1/features?verbose=true
 * Returns full feature + domain detail including disabled entries.
 *
 * @param {string} token
 */
function getTenantFeaturesVerbose(token) {
  return createClient({ token }).get('/api/v1/features', { verbose: 'true' });
}

/**
 * POST /internal/features/domains/enable
 * @param {string} token
 * @param {string} domainKey
 */
function enableDomain(token, domainKey) {
  return createClient({ token }).post('/internal/features/domains/enable', { domain: domainKey });
}

/**
 * POST /internal/features/domains/disable
 * @param {string} token
 * @param {string} domainKey
 */
function disableDomain(token, domainKey) {
  return createClient({ token }).post('/internal/features/domains/disable', { domain: domainKey });
}

/**
 * POST /internal/features/features/enable
 * @param {string} token
 * @param {string} featureKey
 */
function enableFeature(token, featureKey) {
  return createClient({ token }).post('/internal/features/features/enable', { feature: featureKey });
}

/**
 * POST /internal/features/features/disable
 * @param {string} token
 * @param {string} featureKey
 */
function disableFeature(token, featureKey) {
  return createClient({ token }).post('/internal/features/features/disable', { feature: featureKey });
}

module.exports = {
  ApiClient,
  createClient,
  defaultClient,
  // Voice
  sendVoiceWebhook,
  sendVoiceWebhookSigned,
  listVoiceCalls,
  getVoiceCall,
  getCallSession,
  getVoiceCallEvents,
  getVoiceSession,
  postVoiceFallback,
  postVoiceHandover,
  retryVoiceEvent,
  // Features — read
  getTenantFeatures,
  getTenantFeaturesVerbose,
  // Features — management
  enableDomain,
  disableDomain,
  enableFeature,
  disableFeature,
};
