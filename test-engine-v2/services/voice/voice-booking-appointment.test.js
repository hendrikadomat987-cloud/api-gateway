'use strict';

/**
 * Voice — Booking / book_appointment
 *
 * Verifies that a VAPI tool-calls webhook invoking book_appointment
 * returns a confirmed appointment from the appointments service.
 */

const config = require('../../config/config');

const {
  sendVoiceWebhook,
  listVoiceCalls,
} = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
} = require('../../core/factories');

// ─────────────────────────────────────────────────────────────────────────────

const TOKEN   = config.tokens.tenantA;
const CALL_ID = uniqueVoiceCallId('test-call-book-appointment');

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / booking / book_appointment', () => {
  let internalCallId;

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

  it('tool-calls webhook with book_appointment → 200 with confirmed appointment', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'book_appointment', {
        customer_id:      'test-customer',
        start:            new Date().toISOString(),
        duration_minutes: 30,
      }),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const toolResult = results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`Tool failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(typeof toolResult.appointment_id).toBe('string');
    expect(typeof toolResult.status).toBe('string');
  });
});
