'use strict';

/**
 * Voice — Tenant Isolation / RLS Test
 *
 * Verifies multi-tenant data isolation:
 *   1. Tenant A creates a call via webhook
 *   2. Tenant A resolves the internal UUID via GET /voice/calls
 *   3. Tenant B cannot read that call by internal UUID
 *   4. Tenant B cannot read that call's events by internal UUID
 *   5. Tenant B's call list does NOT contain Tenant A's call (by provider_call_id)
 *
 * NOTE on internal UUID:
 *   GET /voice/calls/:id and GET /voice/calls/:id/events expect the internal
 *   voice_calls.id UUID. We resolve it via Tenant A's GET /voice/calls list.
 *   Tenant B cannot derive the internal UUID from just provider_call_id,
 *   but we use the known UUID explicitly to confirm RLS blocks the access.
 */

const config = require('../../config/config');

const {
  sendVoiceWebhook,
  getVoiceCall,
  getVoiceCallEvents,
  listVoiceCalls,
} = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  uniqueVoiceCallId,
} = require('../../core/factories');

const {
  assertTenantIsolationFailure,
} = require('../../core/assertions');

// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_A = config.tokens.tenantA;
const TOKEN_B = config.tokens.tenantB;

// Unique provider_call_id per run — prevents collision with persisted data
const RLS_PROVIDER_CALL_ID = uniqueVoiceCallId('test-call-rls');

/**
 * Resolve the internal voice_calls.id UUID from a provider_call_id.
 *
 * @param {string} token
 * @param {string} providerCallId
 * @returns {Promise<string|null>}
 */
async function findInternalCallId(token, providerCallId) {
  const res = await listVoiceCalls(token);
  if (res.status !== 200 || !res.data?.success) return null;
  const call = res.data.data.find((c) => c.provider_call_id === providerCallId);
  return call?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / tenant-isolation', () => {
  let internalCallId;

  // ── Setup: Tenant A creates a call ──────────────────────────────────────────

  it('setup — Tenant A sends status-update webhook (creates call)', async () => {
    const payload = buildVapiStatusUpdate(RLS_PROVIDER_CALL_ID);
    const res     = await sendVoiceWebhook(payload);

    expect(res.status).toBeLessThan(300);

    if (res.data && res.data.success === false) {
      throw new Error(
        `Setup failed — webhook rejected.\nprovider_call_id: ${RLS_PROVIDER_CALL_ID}\n` +
        `Response: ${JSON.stringify(res.data)}`
      );
    }
  });

  it('setup — Tenant A resolves internal UUID', async () => {
    internalCallId = await findInternalCallId(TOKEN_A, RLS_PROVIDER_CALL_ID);
    if (!internalCallId) {
      throw new Error(
        `Tenant A cannot find call after webhook.\n` +
        `provider_call_id: ${RLS_PROVIDER_CALL_ID}`
      );
    }
  });

  it('Tenant A can read own call by internal UUID', async () => {
    if (!internalCallId) return;

    const res = await getVoiceCall(TOKEN_A, internalCallId);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.provider_call_id).toBe(RLS_PROVIDER_CALL_ID);
  });

  // ── Cross-tenant access: Tenant B must be denied ───────────────────────────

  it('Tenant B cannot read Tenant A call by internal UUID (GET /voice/calls/:id)', async () => {
    if (!internalCallId) return;

    const res = await getVoiceCall(TOKEN_B, internalCallId);

    try {
      assertTenantIsolationFailure(res, internalCallId);
    } catch (err) {
      throw new Error(
        `RLS violation — Tenant B can read Tenant A's call.\n` +
        `internal UUID: ${internalCallId}\n` +
        `provider_call_id: ${RLS_PROVIDER_CALL_ID}\n` +
        `Status: ${res.status}\n` +
        `Body: ${JSON.stringify(res.data)}`
      );
    }
  });

  it('Tenant B cannot read Tenant A call events (GET /voice/calls/:id/events)', async () => {
    if (!internalCallId) return;

    const res = await getVoiceCallEvents(TOKEN_B, internalCallId);

    try {
      assertTenantIsolationFailure(res, internalCallId);
    } catch (err) {
      throw new Error(
        `RLS violation — Tenant B can read Tenant A's call events.\n` +
        `internal UUID: ${internalCallId}\n` +
        `provider_call_id: ${RLS_PROVIDER_CALL_ID}\n` +
        `Status: ${res.status}\n` +
        `Body: ${JSON.stringify(res.data)}`
      );
    }
  });

  it("Tenant B's call list does not contain Tenant A's call (by provider_call_id)", async () => {
    const res = await listVoiceCalls(TOKEN_B);

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);

    const calls = res.data.data;
    expect(Array.isArray(calls)).toBe(true);

    // Check by both provider_call_id and internal UUID to cover all leak vectors
    const leaked = calls.find(
      (c) => c.provider_call_id === RLS_PROVIDER_CALL_ID || c.id === internalCallId
    );
    if (leaked) {
      throw new Error(
        `DATA LEAK: Tenant A's call appears in Tenant B's list.\n` +
        `provider_call_id: ${RLS_PROVIDER_CALL_ID}\n` +
        `internal UUID: ${internalCallId}\n` +
        `Leaked entry: ${JSON.stringify(leaked)}`
      );
    }
  });
});
