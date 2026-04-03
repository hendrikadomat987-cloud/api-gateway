'use strict';

/**
 * Voice — Callback Happy Path
 *
 * Verifies that a VAPI tool-calls webhook invoking create_callback_request
 * persists the request and returns a callback_request_id in the response.
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

const TOKEN    = config.tokens.tenantA;
const CALL_ID  = uniqueVoiceCallId('test-call-callback');

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / callback', () => {
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
  });

  it('tool-calls webhook with create_callback_request → 200 with callback_request_id', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'create_callback_request', {
        preferred_time: 'morgen vormittag',
        notes:          'bitte zurückrufen',
      }),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const toolResult = results[0].result;
    expect(toolResult.success).toBe(true);
    expect(toolResult.callback_request_id).toBeDefined();
  });
});
