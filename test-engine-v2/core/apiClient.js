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
  delete(path, data)              { return this._request('DELETE', path, data); }
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
  return createClient({ token }).get('/features');
}

/**
 * GET /features?verbose=true
 * Returns full feature + domain detail including disabled entries.
 *
 * @param {string} token
 */
function getTenantFeaturesVerbose(token) {
  return createClient({ token }).get('/features', { verbose: 'true' });
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
 * POST /api/v1/internal/features/domains/disable
 * @param {string} token
 * @param {string} domainKey
 */
function disableDomain(token, domainKey) {
  return createClient({ token }).post('/internal/features/domains/disable', { domain: domainKey });
}

/**
 * POST /api/v1/internal/features/features/enable
 * @param {string} token
 * @param {string} featureKey
 */
function enableFeature(token, featureKey) {
  return createClient({ token }).post('/internal/features/features/enable', { feature: featureKey });
}

/**
 * POST /api/v1/internal/features/features/disable
 * @param {string} token
 * @param {string} featureKey
 */
function disableFeature(token, featureKey) {
  return createClient({ token }).post('/internal/features/features/disable', { feature: featureKey });
}

/**
 * POST /api/v1/internal/plans/assign
 * @param {string} token
 * @param {string} planKey
 */
function assignPlan(token, planKey) {
  return createClient({ token }).post('/internal/plans/assign', { plan: planKey });
}

/**
 * GET /api/v1/internal/plans/current
 * @param {string} token
 */
function getCurrentPlan(token) {
  return createClient({ token }).get('/internal/plans/current');
}

/**
 * GET /api/v1/usage/current
 * @param {string} token
 */
function getUsageCurrent(token) {
  return createClient({ token }).get('/usage/current');
}

/**
 * POST /api/v1/internal/usage/reset
 * @param {string} token
 * @param {object} [body]  { period_start?: string }
 */
function resetUsageCounters(token, body = {}) {
  return createClient({ token }).post('/internal/usage/reset', body);
}

/**
 * POST /api/v1/internal/usage/overrides
 * Sets a tenant limit override.
 * @param {string} token
 * @param {string} featureKey
 * @param {number|null} limitValue  null = explicitly unlimited
 * @param {string} [limitType]      defaults to 'tool_calls_per_month'
 */
function setUsageOverride(token, featureKey, limitValue, limitType = 'tool_calls_per_month') {
  return createClient({ token }).post('/internal/usage/overrides', {
    feature_key: featureKey,
    limit_type:  limitType,
    limit_value: limitValue,
  });
}

/**
 * DELETE /api/v1/internal/usage/overrides
 * Removes a tenant limit override (plan limit or unlimited takes effect).
 * @param {string} token
 * @param {string} featureKey
 * @param {string} [limitType]
 */
function deleteUsageOverride(token, featureKey, limitType = 'tool_calls_per_month') {
  return createClient({ token }).delete('/internal/usage/overrides', {
    feature_key: featureKey,
    limit_type:  limitType,
  });
}

// ── Admin API ─────────────────────────────────────────────────────────────────
//
// All admin endpoints are under /api/v1/internal/admin/.
// Authentication uses a static ADMIN_TOKEN Bearer secret (not a JWT).

/**
 * Factory — creates a pre-configured admin client.
 * Reads TOKEN_ADMIN from the environment by default.
 */
function createAdminClient(token) {
  return createClient({ token: token !== undefined ? token : (process.env.TOKEN_ADMIN || '') });
}

/** GET /api/v1/internal/admin/tenants */
function adminListTenants(token) {
  return createAdminClient(token).get('/internal/admin/tenants');
}

/** GET /api/v1/internal/admin/tenants/:id */
function adminGetTenant(token, tenantId) {
  return createAdminClient(token).get(`/internal/admin/tenants/${tenantId}`);
}

/** POST /api/v1/internal/admin/tenants */
function adminUpsertTenant(token, body) {
  return createAdminClient(token).post('/internal/admin/tenants', body);
}

/** GET /api/v1/internal/admin/plans */
function adminListPlans(token) {
  return createAdminClient(token).get('/internal/admin/plans');
}

/** GET /api/v1/internal/admin/plans/:key */
function adminGetPlan(token, planKey) {
  return createAdminClient(token).get(`/internal/admin/plans/${planKey}`);
}

/** POST /api/v1/internal/admin/tenants/:id/plan  { plan } */
function adminAssignPlan(token, tenantId, planKey) {
  return createAdminClient(token).post(`/internal/admin/tenants/${tenantId}/plan`, { plan: planKey });
}

/** POST /api/v1/internal/admin/tenants/:id/features/enable  { feature } */
function adminEnableFeature(token, tenantId, featureKey) {
  return createAdminClient(token).post(`/internal/admin/tenants/${tenantId}/features/enable`, { feature: featureKey });
}

/** POST /api/v1/internal/admin/tenants/:id/features/disable  { feature } */
function adminDisableFeature(token, tenantId, featureKey) {
  return createAdminClient(token).post(`/internal/admin/tenants/${tenantId}/features/disable`, { feature: featureKey });
}

/** POST /api/v1/internal/admin/tenants/:id/domains/enable  { domain } */
function adminEnableDomain(token, tenantId, domainKey) {
  return createAdminClient(token).post(`/internal/admin/tenants/${tenantId}/domains/enable`, { domain: domainKey });
}

/** POST /api/v1/internal/admin/tenants/:id/domains/disable  { domain } */
function adminDisableDomain(token, tenantId, domainKey) {
  return createAdminClient(token).post(`/internal/admin/tenants/${tenantId}/domains/disable`, { domain: domainKey });
}

/** GET /api/v1/internal/admin/tenants/:id/limits */
function adminGetLimits(token, tenantId) {
  return createAdminClient(token).get(`/internal/admin/tenants/${tenantId}/limits`);
}

/**
 * POST /api/v1/internal/admin/tenants/:id/limits
 * { feature_key, limit_type?, limit_value }
 */
function adminSetLimit(token, tenantId, featureKey, limitValue, limitType = 'tool_calls_per_month') {
  return createAdminClient(token).post(`/internal/admin/tenants/${tenantId}/limits`, {
    feature_key: featureKey,
    limit_type:  limitType,
    limit_value: limitValue,
  });
}

/** DELETE /api/v1/internal/admin/tenants/:id/limits  { feature_key, limit_type? } */
function adminDeleteLimit(token, tenantId, featureKey, limitType = 'tool_calls_per_month') {
  return createAdminClient(token).delete(`/internal/admin/tenants/${tenantId}/limits`, {
    feature_key: featureKey,
    limit_type:  limitType,
  });
}

/** GET /api/v1/internal/admin/tenants/:id/usage */
function adminGetUsage(token, tenantId) {
  return createAdminClient(token).get(`/internal/admin/tenants/${tenantId}/usage`);
}

/** POST /api/v1/internal/admin/tenants/:id/usage/reset  { period_start? } */
function adminResetUsage(token, tenantId, body = {}) {
  return createAdminClient(token).post(`/internal/admin/tenants/${tenantId}/usage/reset`, body);
}

module.exports = {
  ApiClient,
  createClient,
  defaultClient,
  createAdminClient,
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
  // Plans — management
  assignPlan,
  getCurrentPlan,
  // Usage — read
  getUsageCurrent,
  // Usage — management
  resetUsageCounters,
  setUsageOverride,
  deleteUsageOverride,
  // Admin — tenants
  adminListTenants,
  adminGetTenant,
  adminUpsertTenant,
  // Admin — plans
  adminListPlans,
  adminGetPlan,
  // Admin — tenant management
  adminAssignPlan,
  adminEnableFeature,
  adminDisableFeature,
  adminEnableDomain,
  adminDisableDomain,
  // Admin — limits
  adminGetLimits,
  adminSetLimit,
  adminDeleteLimit,
  // Admin — usage
  adminGetUsage,
  adminResetUsage,
};
