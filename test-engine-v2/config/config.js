'use strict';

const path = require('path');

// Load .env from the test-engine root regardless of where Jest is invoked from
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// ── Token resolution ──────────────────────────────────────────────────────────

// Support legacy TOKEN env var as fallback for TOKEN_TENANT_A
const tenantA = process.env.TOKEN_TENANT_A || process.env.TOKEN || '';
const tenantB = process.env.TOKEN_TENANT_B || '';

// ── Hard validation for required vars ─────────────────────────────────────────

const missing = [];
if (!process.env.API_BASE_URL) missing.push('API_BASE_URL');
if (!tenantA)                  missing.push('TOKEN_TENANT_A');
if (!tenantB)                  missing.push('TOKEN_TENANT_B');

if (missing.length > 0) {
  console.error(
    `[config] FATAL: Missing required environment variables: ${missing.join(', ')}\n` +
    `         Set them in test-engine/.env before running tests.\n` +
    `         See README.md for setup instructions.`
  );
  process.exit(1);
}

// ── Config export ─────────────────────────────────────────────────────────────

const config = {
  // ── API ─────────────────────────────────────────────────────────────────────
  baseUrl: process.env.API_BASE_URL,

  // ── Auth tokens ─────────────────────────────────────────────────────────────
  tokens: {
    /** Valid, non-expired token for Tenant A — primary test token. */
    tenantA,
    /** Valid token for Tenant B — used in RLS / cross-tenant tests. */
    tenantB,
    /** An expired JWT — used to verify 401 TOKEN_EXPIRED responses. */
    expired: process.env.TOKEN_EXPIRED || 'expired-token',
    /** A syntactically invalid string — used to verify 401 INVALID_TOKEN. */
    invalid: process.env.TOKEN_INVALID || 'this-is-not-a-valid-jwt',
  },

  // ── HTTP ────────────────────────────────────────────────────────────────────
  /** Per-request timeout in milliseconds. */
  timeoutMs: parseInt(process.env.TIMEOUT_MS     || '10000', 10),

  // ── Retry ───────────────────────────────────────────────────────────────────
  /** How many times to retry a request on network-layer failure. */
  retries:      parseInt(process.env.RETRY_COUNT    || '3', 10),
  /** Base delay (ms) between retries — doubles on each attempt. */
  retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '500', 10),
};

module.exports = config;
