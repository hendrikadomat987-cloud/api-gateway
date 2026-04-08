'use strict';

/**
 * Voice — Salon Happy Path
 *
 * Validates the full salon booking flow in a single session:
 *   1. get_services          → returns service catalogue with categories
 *   2. create_booking        → creates a draft booking
 *   3. add_booking_service   → adds a service
 *   4. get_booking_summary   → shows current booking state
 *   5. confirm_booking       → finalises the booking
 *   6. persistence           → call, session, events exist and are consistent
 */

const config = require('../../config/config');

const {
  sendVoiceWebhook,
  listVoiceCalls,
  getVoiceCall,
  getCallSession,
  getVoiceCallEvents,
} = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_SALON_ASSISTANT_ID,
} = require('../../core/factories');

const { expectSuccess, assertEventExists, expectUuid } = require('../../core/assertions');

// ─────────────────────────────────────────────────────────────────────────────

jest.setTimeout(120000);

const TOKEN   = config.tokens.tenantA;
const CALL_ID = uniqueVoiceCallId('test-call-salon-happy-path');

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / salon / happy-path', () => {
  let internalCallId;
  let firstServiceId;

  beforeAll(async () => {
    const res = await sendVoiceWebhook(buildVapiStatusUpdate(CALL_ID, {}, VAPI_SALON_ASSISTANT_ID));
    if (res.status >= 300) {
      throw new Error(
        `Setup failed — webhook rejected with ${res.status}.\n` +
        `provider_call_id: ${CALL_ID}\n` +
        `Response: ${JSON.stringify(res.data)}`,
      );
    }

    const list = await listVoiceCalls(TOKEN);
    if (list.status !== 200 || !list.data?.success) {
      throw new Error(`Setup failed — GET /voice/calls returned ${list.status}`);
    }
    const call = list.data.data.find((c) => c.provider_call_id === CALL_ID);
    if (!call) throw new Error(`Setup failed — call not found: ${CALL_ID}`);
    internalCallId = call.id;
  });

  // ── Step 1: get_services ──────────────────────────────────────────────────

  it('step 1 — get_services returns categories with services', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'get_services', {}, VAPI_SALON_ASSISTANT_ID),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const toolResult = results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`get_services failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(Array.isArray(toolResult.categories)).toBe(true);
    expect(toolResult.categories.length).toBeGreaterThan(0);

    const firstCategory = toolResult.categories[0];
    expect(typeof firstCategory.name).toBe('string');
    expect(Array.isArray(firstCategory.services)).toBe(true);
    expect(firstCategory.services.length).toBeGreaterThan(0);

    const firstService = firstCategory.services[0];
    expect(typeof firstService.id).toBe('string');
    expect(typeof firstService.name).toBe('string');
    expect(typeof firstService.price).toBe('number');
    expect(typeof firstService.duration_minutes).toBe('number');
    expect(firstService.duration_minutes).toBeGreaterThan(0);

    firstServiceId = firstService.id;
  });

  // ── Step 2: create_booking ────────────────────────────────────────────────

  it('step 2 — create_booking returns created booking', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'create_booking', {}, VAPI_SALON_ASSISTANT_ID),
    );

    expect(res.status).toBe(200);

    const toolResult = res.data?.results?.[0]?.result;
    if (toolResult.success !== true) {
      throw new Error(`create_booking failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(typeof toolResult.booking_id).toBe('string');
    expect(toolResult.booking_id.length).toBeGreaterThan(0);
    expect(toolResult.status).toBe('created');
  });

  // ── Step 3: add_booking_service ───────────────────────────────────────────

  it('step 3 — add_booking_service adds a service', async () => {
    if (!firstServiceId) throw new Error('step 1 must run first');

    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'add_booking_service',
        { service_id: firstServiceId },
        VAPI_SALON_ASSISTANT_ID,
      ),
    );

    expect(res.status).toBe(200);

    const toolResult = res.data?.results?.[0]?.result;
    if (toolResult.success !== true) {
      throw new Error(`add_booking_service failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(typeof toolResult.booking_id).toBe('string');
    expect(toolResult.status).toBe('service_added');
    expect(toolResult.service).toBeDefined();
    expect(typeof toolResult.service.id).toBe('string');
    expect(typeof toolResult.service.name).toBe('string');
    expect(typeof toolResult.service.price).toBe('number');
    expect(toolResult.service.price).toBeGreaterThan(0);
    expect(typeof toolResult.service.duration_minutes).toBe('number');
    expect(toolResult.total_price_cents).toBeGreaterThan(0);
  });

  // ── Step 4: get_booking_summary ───────────────────────────────────────────

  it('step 4 — get_booking_summary shows 1 service', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'get_booking_summary', {}, VAPI_SALON_ASSISTANT_ID),
    );

    expect(res.status).toBe(200);

    const toolResult = res.data?.results?.[0]?.result;
    if (toolResult.success !== true) {
      throw new Error(`get_booking_summary failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(toolResult.service_count).toBe(1);
    expect(Array.isArray(toolResult.services)).toBe(true);
    expect(toolResult.services.length).toBe(1);
    expect(toolResult.total_price_cents).toBeGreaterThan(0);
    expect(toolResult.status).toBe('draft');
  });

  // ── Step 5: confirm_booking ───────────────────────────────────────────────

  it('step 5 — confirm_booking confirms the booking', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'confirm_booking',
        {
          customer_name:      'Test Kunde',
          selected_date:      '2026-05-01',
          selected_time_slot: '10:00',
        },
        VAPI_SALON_ASSISTANT_ID,
      ),
    );

    expect(res.status).toBe(200);

    const toolResult = res.data?.results?.[0]?.result;
    if (toolResult.success !== true) {
      throw new Error(`confirm_booking failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(typeof toolResult.booking_id).toBe('string');
    expect(toolResult.status).toBe('confirmed');
    expect(toolResult.total_price_cents).toBeGreaterThan(0);
    expect(toolResult.service_count).toBe(1);
  });

  // ── Step 6: persistence ───────────────────────────────────────────────────

  it('step 6 — call and session exist with correct identifiers', async () => {
    const callRes   = await getVoiceCall(TOKEN, internalCallId);
    const call      = expectSuccess(callRes);
    expect(call.id).toBe(internalCallId);
    expect(call.provider_call_id).toBe(CALL_ID);

    const sessionRes = await getCallSession(TOKEN, internalCallId);
    const session    = expectSuccess(sessionRes);
    expectUuid(session.id);
    expect(session.voice_call_id).toBe(internalCallId);
    expect(session.status).toBe('active');
  });

  it('step 7 — events exist for all webhook messages', async () => {
    const res    = await getVoiceCallEvents(TOKEN, internalCallId);
    const events = expectSuccess(res);

    expect(Array.isArray(events)).toBe(true);
    assertEventExists(events, 'call.status_update');
    assertEventExists(events, 'tool.invoked');
    // 1 status-update + 5 tool-calls = at least 6 events
    expect(events.length).toBeGreaterThanOrEqual(6);
  });
});
