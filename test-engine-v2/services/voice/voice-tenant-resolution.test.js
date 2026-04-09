'use strict';

/**
 * Voice — Tenant Resolution
 *
 * Proves that incoming voice webhooks are resolved to the correct tenant and
 * track based solely on the assistant ID in the webhook payload — never from
 * HTTP headers or trusted caller input.
 *
 * Invariants verified:
 *   A. Salon assistant ID → session.track_type = 'salon',
 *      call.tenant_id = salon tenant, call not visible to restaurant token
 *   B. Restaurant assistant ID → session.track_type = 'restaurant',
 *      call.tenant_id = restaurant tenant, call not visible to salon token
 *   C. Unknown/unregistered assistant ID → 400 VOICE_TENANT_NOT_RESOLVED,
 *      no call or session created under any known tenant
 *
 * Resolution path (from tenant-resolution.service.ts):
 *   1. Called phone number → voice_numbers → voice_agents row → tenant
 *   2. provider_agent_id  → voice_agents row (by provider_agent_id) → tenant
 *   Tests use only path 2 (no phone number in test payload).
 */

const config = require('../../config/config');
const {
  sendVoiceWebhook,
  listVoiceCalls,
  getVoiceCall,
  getCallSession,
} = require('../../core/apiClient');
const {
  buildVapiStatusUpdate,
  uniqueVoiceCallId,
  VAPI_RESTAURANT_ASSISTANT_ID,
  VAPI_SALON_ASSISTANT_ID,
} = require('../../core/factories');
const { expectSuccess } = require('../../core/assertions');

jest.setTimeout(120000);

const TOKEN_RESTAURANT = config.tokens.tenantA;
const TOKEN_SALON      = config.tokens.tenantSalon;

// Stable known tenant IDs (decoded from JWTs in .env)
const RESTAURANT_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SALON_TENANT_ID      = '00000000-0000-0000-0000-000000000002';

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / tenant-resolution', () => {
  // ── A: Salon assistant → salon track ──────────────────────────────────────

  describe('A — salon assistant resolves to salon track', () => {
    const CALL_ID = uniqueVoiceCallId('tres-salon');
    let callId;    // voice_calls.id (internal UUID)
    let sessionId; // voice_sessions.id

    beforeAll(async () => {
      const res = await sendVoiceWebhook(
        buildVapiStatusUpdate(CALL_ID, {}, VAPI_SALON_ASSISTANT_ID),
      );
      if (res.status >= 300) {
        throw new Error(
          `Setup A: salon webhook rejected with ${res.status}.\n` +
          `Response: ${JSON.stringify(res.data)}`,
        );
      }

      const list = await listVoiceCalls(TOKEN_SALON);
      const call = list.data?.data?.find((c) => c.provider_call_id === CALL_ID);
      if (!call) throw new Error(`Setup A: salon call not found in list: ${CALL_ID}`);
      callId = call.id;
    });

    it('call is visible to salon tenant and has track_type = salon', async () => {
      const callRes = await getVoiceCall(TOKEN_SALON, callId);
      const call    = expectSuccess(callRes);

      expect(call.id).toBe(callId);
      expect(call.provider_call_id).toBe(CALL_ID);
      // track_type on the voice_calls row is set by the orchestrator
      expect(call.track_type).toBe('salon');
      // tenant_id must match the salon tenant — never the restaurant
      expect(call.tenant_id).toBe(SALON_TENANT_ID);
      expect(call.tenant_id).not.toBe(RESTAURANT_TENANT_ID);
    });

    it('session has track_type = salon and belongs to salon tenant', async () => {
      const sessionRes = await getCallSession(TOKEN_SALON, callId);
      const session    = expectSuccess(sessionRes);

      sessionId = session.id;
      expect(session.voice_call_id).toBe(callId);
      // track_type on voice_sessions is the authoritative runtime discriminator
      expect(session.track_type).toBe('salon');
      // tenant_id on the session must match the salon tenant
      expect(session.tenant_id).toBe(SALON_TENANT_ID);
      expect(session.tenant_id).not.toBe(RESTAURANT_TENANT_ID);
    });

    it('salon call is NOT visible to the restaurant tenant', async () => {
      // Restaurant token must not find this call in its list
      const list  = await listVoiceCalls(TOKEN_RESTAURANT);
      expect(list.status).toBe(200);
      const calls = list.data?.data ?? [];

      const leaked = calls.find(
        (c) => c.provider_call_id === CALL_ID || c.id === callId,
      );
      if (leaked) {
        throw new Error(
          `DATA LEAK: Salon call (provider_call_id: ${CALL_ID}) appears in restaurant token list.\n` +
          `Leaked entry: ${JSON.stringify(leaked)}`,
        );
      }

      // Also verify direct read is blocked
      const directRes = await getVoiceCall(TOKEN_RESTAURANT, callId);
      const hasData =
        directRes.status === 200 &&
        directRes.data?.success === true &&
        directRes.data?.data?.id === callId;

      if (hasData) {
        throw new Error(
          `DATA LEAK: Restaurant token can read salon call directly.\n` +
          `call.id: ${callId}\nBody: ${JSON.stringify(directRes.data)}`,
        );
      }
    });
  });

  // ── B: Restaurant assistant → restaurant track ─────────────────────────────

  describe('B — restaurant assistant resolves to restaurant track', () => {
    const CALL_ID = uniqueVoiceCallId('tres-restaurant');
    let callId;

    beforeAll(async () => {
      const res = await sendVoiceWebhook(
        buildVapiStatusUpdate(CALL_ID, {}, VAPI_RESTAURANT_ASSISTANT_ID),
      );
      if (res.status >= 300) {
        throw new Error(
          `Setup B: restaurant webhook rejected with ${res.status}.\n` +
          `Response: ${JSON.stringify(res.data)}`,
        );
      }

      const list = await listVoiceCalls(TOKEN_RESTAURANT);
      const call = list.data?.data?.find((c) => c.provider_call_id === CALL_ID);
      if (!call) throw new Error(`Setup B: restaurant call not found in list: ${CALL_ID}`);
      callId = call.id;
    });

    it('call is visible to restaurant tenant and has track_type = restaurant', async () => {
      const callRes = await getVoiceCall(TOKEN_RESTAURANT, callId);
      const call    = expectSuccess(callRes);

      expect(call.id).toBe(callId);
      expect(call.provider_call_id).toBe(CALL_ID);
      expect(call.track_type).toBe('restaurant');
      expect(call.tenant_id).toBe(RESTAURANT_TENANT_ID);
      expect(call.tenant_id).not.toBe(SALON_TENANT_ID);
    });

    it('session has track_type = restaurant and belongs to restaurant tenant', async () => {
      const sessionRes = await getCallSession(TOKEN_RESTAURANT, callId);
      const session    = expectSuccess(sessionRes);

      expect(session.voice_call_id).toBe(callId);
      expect(session.track_type).toBe('restaurant');
      expect(session.tenant_id).toBe(RESTAURANT_TENANT_ID);
      expect(session.tenant_id).not.toBe(SALON_TENANT_ID);
    });

    it('restaurant call is NOT visible to the salon tenant', async () => {
      const list  = await listVoiceCalls(TOKEN_SALON);
      expect(list.status).toBe(200);
      const calls = list.data?.data ?? [];

      const leaked = calls.find(
        (c) => c.provider_call_id === CALL_ID || c.id === callId,
      );
      if (leaked) {
        throw new Error(
          `DATA LEAK: Restaurant call (provider_call_id: ${CALL_ID}) appears in salon token list.\n` +
          `Leaked entry: ${JSON.stringify(leaked)}`,
        );
      }

      // Also verify direct read is blocked
      const directRes = await getVoiceCall(TOKEN_SALON, callId);
      const hasData =
        directRes.status === 200 &&
        directRes.data?.success === true &&
        directRes.data?.data?.id === callId;

      if (hasData) {
        throw new Error(
          `DATA LEAK: Salon token can read restaurant call directly.\n` +
          `call.id: ${callId}\nBody: ${JSON.stringify(directRes.data)}`,
        );
      }
    });
  });

  // ── C: Unknown assistant ID → hard rejection ──────────────────────────────

  describe('C — unknown assistant ID is rejected (no tenant resolves)', () => {
    // A provider_agent_id that has no voice_agents row in the DB
    const UNKNOWN_ASSISTANT = 'totally-unknown-assistant-xyzzy-nonexistent';
    const CALL_ID           = uniqueVoiceCallId('tres-unknown-agent');

    it('webhook returns 400 VOICE_TENANT_NOT_RESOLVED', async () => {
      const res = await sendVoiceWebhook(
        buildVapiStatusUpdate(CALL_ID, {}, UNKNOWN_ASSISTANT),
      );

      // Tenant resolution failure → VoiceTenantNotResolvedError → HTTP 400
      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
      expect(res.data.error).toBeDefined();
      expect(res.data.error.code).toBe('VOICE_TENANT_NOT_RESOLVED');
    });

    it('no call was created under the restaurant tenant', async () => {
      const list  = await listVoiceCalls(TOKEN_RESTAURANT);
      expect(list.status).toBe(200);
      const calls = list.data?.data ?? [];

      const ghost = calls.find((c) => c.provider_call_id === CALL_ID);
      if (ghost) {
        throw new Error(
          `ISOLATION FAILURE: A call was created under the restaurant tenant\n` +
          `despite an unknown assistant ID.\n` +
          `provider_call_id: ${CALL_ID}\n` +
          `Created entry: ${JSON.stringify(ghost)}`,
        );
      }
    });

    it('no call was created under the salon tenant', async () => {
      const list  = await listVoiceCalls(TOKEN_SALON);
      expect(list.status).toBe(200);
      const calls = list.data?.data ?? [];

      const ghost = calls.find((c) => c.provider_call_id === CALL_ID);
      if (ghost) {
        throw new Error(
          `ISOLATION FAILURE: A call was created under the salon tenant\n` +
          `despite an unknown assistant ID.\n` +
          `provider_call_id: ${CALL_ID}\n` +
          `Created entry: ${JSON.stringify(ghost)}`,
        );
      }
    });
  });
});
