'use strict';

/**
 * Voice — Cross-Tenant Isolation: Restaurant ↔ Salon
 *
 * Proves that the two production tracks are sauber voneinander isoliert:
 *
 *   A. Tools in a restaurant track call cannot access salon data
 *      (track-scoped dispatch blocks salon tools on restaurant context)
 *   B. Tools in a salon track call cannot access restaurant data
 *      (track-scoped dispatch blocks restaurant tools on salon context)
 *   C. Restaurant calls are not visible to the salon tenant
 *      (RLS: list, direct read, events)
 *   D. Salon calls are not visible to the restaurant tenant
 *      (RLS: list, direct read, events)
 *
 * Key facts asserted here that are NOT covered by voice-tenant-isolation.test.js:
 *   - That file only tests Tenant A vs generic Tenant B (no agent seeded for B)
 *   - This file tests the actual two production tracks against each other
 *   - Additionally tests tool-level cross-track isolation (no existing coverage)
 */

const config = require('../../config/config');
const {
  sendVoiceWebhook,
  listVoiceCalls,
  getVoiceCall,
  getVoiceCallEvents,
} = require('../../core/apiClient');
const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_RESTAURANT_ASSISTANT_ID,
  VAPI_SALON_ASSISTANT_ID,
} = require('../../core/factories');

jest.setTimeout(120000);

const TOKEN_RESTAURANT = config.tokens.tenantA;
const TOKEN_SALON      = config.tokens.tenantSalon;

// Stable known tenant IDs (decoded from JWTs in .env)
const RESTAURANT_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SALON_TENANT_ID      = '00000000-0000-0000-0000-000000000002';

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / cross-tenant / isolation (restaurant ↔ salon)', () => {
  // One call per track, created once and shared across all sub-tests.
  // Using unique IDs per run prevents collisions across re-runs.
  const RESTAURANT_CALL_ID = uniqueVoiceCallId('xiso-restaurant');
  const SALON_CALL_ID      = uniqueVoiceCallId('xiso-salon');

  let restaurantInternalId; // voice_calls.id for the restaurant call
  let salonInternalId;      // voice_calls.id for the salon call

  // ── Setup: create one call per track ────────────────────────────────────────

  beforeAll(async () => {
    // Create restaurant call
    const resR = await sendVoiceWebhook(
      buildVapiStatusUpdate(RESTAURANT_CALL_ID, {}, VAPI_RESTAURANT_ASSISTANT_ID),
    );
    if (resR.status >= 300) {
      throw new Error(
        `Setup failed — restaurant webhook rejected with ${resR.status}.\n` +
        `Response: ${JSON.stringify(resR.data)}`,
      );
    }

    // Create salon call
    const resS = await sendVoiceWebhook(
      buildVapiStatusUpdate(SALON_CALL_ID, {}, VAPI_SALON_ASSISTANT_ID),
    );
    if (resS.status >= 300) {
      throw new Error(
        `Setup failed — salon webhook rejected with ${resS.status}.\n` +
        `Response: ${JSON.stringify(resS.data)}`,
      );
    }

    // Resolve internal IDs via their respective tenant tokens
    const listR = await listVoiceCalls(TOKEN_RESTAURANT);
    const callR = listR.data?.data?.find((c) => c.provider_call_id === RESTAURANT_CALL_ID);
    if (!callR) throw new Error(`Setup: restaurant call not found in list: ${RESTAURANT_CALL_ID}`);
    restaurantInternalId = callR.id;

    const listS = await listVoiceCalls(TOKEN_SALON);
    const callS = listS.data?.data?.find((c) => c.provider_call_id === SALON_CALL_ID);
    if (!callS) throw new Error(`Setup: salon call not found in list: ${SALON_CALL_ID}`);
    salonInternalId = callS.id;
  });

  // ── A: Salon tools blocked on restaurant track ────────────────────────────

  describe('A — salon tools blocked on restaurant track', () => {
    it('get_services called from restaurant track returns track-block error (no salon categories)', async () => {
      const res = await sendVoiceWebhook(
        buildVapiToolCall(RESTAURANT_CALL_ID, 'get_services', {}, VAPI_RESTAURANT_ASSISTANT_ID),
      );

      expect(res.status).toBe(200);
      const results = res.data?.results;
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      const result = results[0].result;
      // Track-blocked tools return { error: "Tool not allowed in track '...'" }
      // via vapi-adapter.buildToolCallsResponse — no real data shape
      expect(typeof result.error).toBe('string');
      expect(result.error).toMatch(/not allowed in track/i);

      // Negative: no real salon data must have leaked
      expect(result.categories).toBeUndefined();
      expect(result.services).toBeUndefined();
      expect(result.booking_id).toBeUndefined();
    });

    it('create_booking called from restaurant track returns track-block error (no salon booking_id)', async () => {
      const res = await sendVoiceWebhook(
        buildVapiToolCall(RESTAURANT_CALL_ID, 'create_booking', {}, VAPI_RESTAURANT_ASSISTANT_ID),
      );

      expect(res.status).toBe(200);
      const result = res.data?.results?.[0]?.result;
      expect(typeof result.error).toBe('string');
      expect(result.error).toMatch(/not allowed in track/i);

      // Negative: no salon booking data
      expect(result.booking_id).toBeUndefined();
      expect(result.status).toBeUndefined();
    });
  });

  // ── B: Restaurant tools blocked on salon track ────────────────────────────

  describe('B — restaurant tools blocked on salon track', () => {
    it('get_menu called from salon track returns track-block error (no restaurant categories)', async () => {
      const res = await sendVoiceWebhook(
        buildVapiToolCall(SALON_CALL_ID, 'get_menu', {}, VAPI_SALON_ASSISTANT_ID),
      );

      expect(res.status).toBe(200);
      const results = res.data?.results;
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      const result = results[0].result;
      expect(typeof result.error).toBe('string');
      expect(result.error).toMatch(/not allowed in track/i);

      // Negative: no real restaurant menu data
      expect(result.categories).toBeUndefined();
      expect(result.items).toBeUndefined();
      expect(result.order_id).toBeUndefined();
    });

    it('create_order called from salon track returns track-block error (no restaurant order_id)', async () => {
      const res = await sendVoiceWebhook(
        buildVapiToolCall(SALON_CALL_ID, 'create_order', {}, VAPI_SALON_ASSISTANT_ID),
      );

      expect(res.status).toBe(200);
      const result = res.data?.results?.[0]?.result;
      expect(typeof result.error).toBe('string');
      expect(result.error).toMatch(/not allowed in track/i);

      // Negative: no restaurant order
      expect(result.order_id).toBeUndefined();
    });
  });

  // ── C: Restaurant call not visible to salon tenant ────────────────────────

  describe('C — restaurant call not visible to salon tenant', () => {
    it('salon token list does NOT contain the restaurant call', async () => {
      const res = await listVoiceCalls(TOKEN_SALON);

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      const calls = res.data.data;
      expect(Array.isArray(calls)).toBe(true);

      // Check by both provider_call_id and internal UUID — both leak vectors
      const leaked = calls.find(
        (c) =>
          c.provider_call_id === RESTAURANT_CALL_ID ||
          c.id === restaurantInternalId,
      );
      if (leaked) {
        throw new Error(
          `DATA LEAK: Restaurant call appears in salon token list.\n` +
          `provider_call_id: ${RESTAURANT_CALL_ID}\n` +
          `internal UUID: ${restaurantInternalId}\n` +
          `Leaked entry: ${JSON.stringify(leaked)}`,
        );
      }

      // Additionally: none of the returned calls belong to the restaurant tenant
      const wrongTenant = calls.find((c) => c.tenant_id === RESTAURANT_TENANT_ID);
      if (wrongTenant) {
        throw new Error(
          `DATA LEAK: Salon token list contains a call with restaurant tenant_id.\n` +
          `tenant_id: ${RESTAURANT_TENANT_ID}\n` +
          `Leaked entry: ${JSON.stringify(wrongTenant)}`,
        );
      }
    });

    it('salon token cannot read restaurant call by internal UUID (GET /voice/calls/:id)', async () => {
      if (!restaurantInternalId) {
        throw new Error('Prerequisite: restaurantInternalId not set — check beforeAll');
      }

      const res = await getVoiceCall(TOKEN_SALON, restaurantInternalId);

      // Must NOT return the restaurant call data
      const hasData =
        res.status === 200 &&
        res.data?.success === true &&
        res.data?.data?.id === restaurantInternalId;

      if (hasData) {
        throw new Error(
          `DATA LEAK: Salon token can read restaurant call.\n` +
          `internal UUID: ${restaurantInternalId}\n` +
          `provider_call_id: ${RESTAURANT_CALL_ID}\n` +
          `Status: ${res.status}\nBody: ${JSON.stringify(res.data)}`,
        );
      }
    });

    it('salon token cannot read restaurant call events (GET /voice/calls/:id/events)', async () => {
      if (!restaurantInternalId) {
        throw new Error('Prerequisite: restaurantInternalId not set — check beforeAll');
      }

      const res = await getVoiceCallEvents(TOKEN_SALON, restaurantInternalId);

      const hasEvents =
        res.status === 200 &&
        res.data?.success === true &&
        Array.isArray(res.data?.data) &&
        res.data.data.length > 0;

      if (hasEvents) {
        throw new Error(
          `DATA LEAK: Salon token can read restaurant call events.\n` +
          `internal UUID: ${restaurantInternalId}\n` +
          `Event count: ${res.data.data.length}\n` +
          `Status: ${res.status}\nBody: ${JSON.stringify(res.data)}`,
        );
      }
    });
  });

  // ── D: Salon call not visible to restaurant tenant ────────────────────────

  describe('D — salon call not visible to restaurant tenant', () => {
    it('restaurant token list does NOT contain the salon call', async () => {
      const res = await listVoiceCalls(TOKEN_RESTAURANT);

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      const calls = res.data.data;
      expect(Array.isArray(calls)).toBe(true);

      const leaked = calls.find(
        (c) =>
          c.provider_call_id === SALON_CALL_ID ||
          c.id === salonInternalId,
      );
      if (leaked) {
        throw new Error(
          `DATA LEAK: Salon call appears in restaurant token list.\n` +
          `provider_call_id: ${SALON_CALL_ID}\n` +
          `internal UUID: ${salonInternalId}\n` +
          `Leaked entry: ${JSON.stringify(leaked)}`,
        );
      }

      // Additionally: none of the returned calls belong to the salon tenant
      const wrongTenant = calls.find((c) => c.tenant_id === SALON_TENANT_ID);
      if (wrongTenant) {
        throw new Error(
          `DATA LEAK: Restaurant token list contains a call with salon tenant_id.\n` +
          `tenant_id: ${SALON_TENANT_ID}\n` +
          `Leaked entry: ${JSON.stringify(wrongTenant)}`,
        );
      }
    });

    it('restaurant token cannot read salon call by internal UUID (GET /voice/calls/:id)', async () => {
      if (!salonInternalId) {
        throw new Error('Prerequisite: salonInternalId not set — check beforeAll');
      }

      const res = await getVoiceCall(TOKEN_RESTAURANT, salonInternalId);

      const hasData =
        res.status === 200 &&
        res.data?.success === true &&
        res.data?.data?.id === salonInternalId;

      if (hasData) {
        throw new Error(
          `DATA LEAK: Restaurant token can read salon call.\n` +
          `internal UUID: ${salonInternalId}\n` +
          `provider_call_id: ${SALON_CALL_ID}\n` +
          `Status: ${res.status}\nBody: ${JSON.stringify(res.data)}`,
        );
      }
    });

    it('restaurant token cannot read salon call events (GET /voice/calls/:id/events)', async () => {
      if (!salonInternalId) {
        throw new Error('Prerequisite: salonInternalId not set — check beforeAll');
      }

      const res = await getVoiceCallEvents(TOKEN_RESTAURANT, salonInternalId);

      const hasEvents =
        res.status === 200 &&
        res.data?.success === true &&
        Array.isArray(res.data?.data) &&
        res.data.data.length > 0;

      if (hasEvents) {
        throw new Error(
          `DATA LEAK: Restaurant token can read salon call events.\n` +
          `internal UUID: ${salonInternalId}\n` +
          `Event count: ${res.data.data.length}\n` +
          `Status: ${res.status}\nBody: ${JSON.stringify(res.data)}`,
        );
      }
    });
  });
});
