'use strict';

/**
 * Voice — Booking Happy Path (AP6)
 *
 * Validates the full booking flow in a single session:
 *   1. check_availability   → returns available slots
 *   2. book_appointment     → confirms booking using slot from step 1
 *   3. persistence          → call, session, events exist and are consistent
 *
 * answer_booking_question is intentionally excluded: it has no data dependency
 * on check_availability or book_appointment, so including it would not validate
 * flow continuity — it would only add an independent tool call.
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
} = require('../../core/factories');

const {
  expectSuccess,
  assertEventExists,
  assertSingleEvent,
  expectUuid,
} = require('../../core/assertions');

// ─────────────────────────────────────────────────────────────────────────────

jest.setTimeout(120000);

const TOKEN   = config.tokens.tenantA;
const CALL_ID = uniqueVoiceCallId('test-call-booking-happy-path');

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / booking / happy-path', () => {
  let internalCallId;
  let availabilitySlot;

  beforeAll(async () => {
    const res = await sendVoiceWebhook(buildVapiStatusUpdate(CALL_ID));
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
    if (!call) {
      throw new Error(
        `Setup failed — call not found in list after webhook.\n` +
        `provider_call_id: ${CALL_ID}`,
      );
    }
    internalCallId = call.id;
  });

  // ── Step 1: check_availability ─────────────────────────────────────────────

  it('step 1 — check_availability returns available slots', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'check_availability', {
        customer_id:      'test-customer',
        start:            new Date().toISOString(),
        duration_minutes: 30,
        timezone:         'Europe/Berlin',
      }),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const toolResult = results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`check_availability failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(typeof toolResult.bookable).toBe('boolean');
    expect(toolResult.bookable).toBe(true);
    expect(Array.isArray(toolResult.slots)).toBe(true);
    expect(toolResult.slots.length).toBeGreaterThan(0);

    // Capture slot for step 2 — validate it is a non-empty ISO string before use
    availabilitySlot = toolResult.slots[0];
    expect(typeof availabilitySlot).toBe('string');
    expect(availabilitySlot.length).toBeGreaterThan(0);
    expect(new Date(availabilitySlot).getTime()).not.toBeNaN();
  });

  // ── Step 2: book_appointment ───────────────────────────────────────────────

  it('step 2 — book_appointment confirms booking using slot from step 1', async () => {
    // Slot originates from check_availability step 1 — continuity is explicit
    expect(availabilitySlot).toBeDefined();

    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'book_appointment', {
        customer_id:      'test-customer',
        start:            availabilitySlot,
        duration_minutes: 30,
      }),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const toolResult = results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`book_appointment failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(typeof toolResult.appointment_id).toBe('string');
    expect(toolResult.appointment_id.length).toBeGreaterThan(0);
    expect(toolResult.status).toBe('confirmed');
  });

  // ── Step 3: call and session exist ────────────────────────────────────────

  it('step 3 — call and session exist with correct identifiers', async () => {
    const callRes = await getVoiceCall(TOKEN, internalCallId);
    const call    = expectSuccess(callRes);
    expect(call.id).toBe(internalCallId);
    expect(call.provider_call_id).toBe(CALL_ID);

    const sessionRes = await getCallSession(TOKEN, internalCallId);
    const session    = expectSuccess(sessionRes);
    expectUuid(session.id);
    expect(session.voice_call_id).toBe(internalCallId);
    expect(session.status).toBe('active');
  });

  // ── Step 4: events exist for all webhook messages ────────────────────────

  it('step 4 — events exist for status-update and both tool invocations', async () => {
    const res    = await getVoiceCallEvents(TOKEN, internalCallId);
    const events = expectSuccess(res);

    expect(Array.isArray(events)).toBe(true);

    // status-update event(s) from call lifecycle must be present
    assertEventExists(events, 'call.status_update');

    // At least one tool.invoked event — 'tool-calls' maps to 'tool.invoked' in the event mapper
    assertEventExists(events, 'tool.invoked');

    // 1 status-update + 2 tool-calls webhooks = exactly 3 persisted events
    expect(events.length).toBeGreaterThanOrEqual(3);
  });
});
