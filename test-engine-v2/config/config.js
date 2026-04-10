'use strict';

const path = require('path');

// Load .env from the test-engine root regardless of where Jest is invoked from
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// ── Token resolution ──────────────────────────────────────────────────────────

// Support legacy TOKEN env var as fallback for TOKEN_TENANT_A
const tenantA        = process.env.TOKEN_TENANT_A           || process.env.TOKEN || '';
const tenantB        = process.env.TOKEN_TENANT_B           || '';
const tenantSalon    = process.env.TOKEN_TENANT_SALON       || '';
const tenantSalon2   = process.env.TOKEN_TENANT_SALON_2     || '';
// Optional — needed for /api/v1/features tests against the feature gate tenant.
// Generate: a JWT with organization_id = '44444444-4444-4444-4444-444444444444'.
// VAPI webhook tests for this tenant do NOT require this token.
const tenantFeatureGate = process.env.TOKEN_FEATURE_GATE_TENANT || '';
// Optional — static opaque Bearer secret for /internal/admin/* endpoints.
// Generate: openssl rand -hex 32  (store in ADMIN_TOKEN on the server too).
// Tests that require admin access are skipped when this is absent.
const admin = process.env.TOKEN_ADMIN || '';

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
    /** Valid token for Salon Tenant (00000000-…-0002) — Morgenlicht, Köln. */
    tenantSalon,
    /** Valid token for Salon Tenant 2 (00000000-…-0003) — Studio Nord, Hamburg. */
    tenantSalon2,
    /**
     * Optional. JWT with organization_id = '44444444-4444-4444-4444-444444444444'.
     * Required only for /api/v1/features tests against the feature gate tenant.
     * VAPI webhook tests for Layer-2 gating work without this token.
     */
    tenantFeatureGate,
    /**
     * Static opaque Bearer secret for /internal/admin/* endpoints.
     * Must match ADMIN_TOKEN on the server.  Tests skip when absent.
     */
    admin,
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
