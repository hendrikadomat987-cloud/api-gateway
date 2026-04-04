'use strict';

/**
 * Voice — Restaurant Happy Path
 *
 * Validates the full restaurant flow in a single session:
 *   1. get_menu        → returns categories with items
 *   2. create_order    → confirms order creation
 *   3. add_order_item  → confirms item was added
 *   4. confirm_order   → confirms order submission
 *   5. persistence     → call, session, events exist and are consistent
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
  VAPI_RESTAURANT_ASSISTANT_ID,
} = require('../../core/factories');

const {
  expectSuccess,
  assertEventExists,
  expectUuid,
} = require('../../core/assertions');

// ─────────────────────────────────────────────────────────────────────────────

jest.setTimeout(120000);

const TOKEN   = config.tokens.tenantA;
const CALL_ID = uniqueVoiceCallId('test-call-restaurant-happy-path');

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / restaurant / happy-path', () => {
  let internalCallId;

  beforeAll(async () => {
    const res = await sendVoiceWebhook(buildVapiStatusUpdate(CALL_ID, {}, VAPI_RESTAURANT_ASSISTANT_ID));
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

  // ── Step 1: get_menu ───────────────────────────────────────────────────────

  it('step 1 — get_menu returns categories with items', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'get_menu', {}, VAPI_RESTAURANT_ASSISTANT_ID),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const toolResult = results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`get_menu failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(Array.isArray(toolResult.categories)).toBe(true);
    expect(toolResult.categories.length).toBeGreaterThan(0);

    const firstCategory = toolResult.categories[0];
    expect(typeof firstCategory.name).toBe('string');
    expect(Array.isArray(firstCategory.items)).toBe(true);
    expect(firstCategory.items.length).toBeGreaterThan(0);

    const firstItem = firstCategory.items[0];
    expect(typeof firstItem.id).toBe('string');
    expect(typeof firstItem.name).toBe('string');
    expect(typeof firstItem.price).toBe('number');
  });

  // ── Step 2: create_order ───────────────────────────────────────────────────

  it('step 2 — create_order returns created order', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'create_order', {}, VAPI_RESTAURANT_ASSISTANT_ID),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const toolResult = results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`create_order failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(typeof toolResult.order_id).toBe('string');
    expect(toolResult.order_id.length).toBeGreaterThan(0);
    expect(toolResult.status).toBe('created');
  });

  // ── Step 3: add_order_item ─────────────────────────────────────────────────

  it('step 3 — add_order_item returns added item', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'add_order_item', {}, VAPI_RESTAURANT_ASSISTANT_ID),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const toolResult = results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`add_order_item failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(typeof toolResult.order_id).toBe('string');
    expect(toolResult.order_id.length).toBeGreaterThan(0);
    expect(toolResult.status).toBe('item_added');
    expect(toolResult.item).toBeDefined();
    expect(toolResult.item.id).toBe('pizza_margherita');
    expect(toolResult.item.name).toBe('Margherita');
    expect(toolResult.item.quantity).toBe(1);
    expect(toolResult.item.price).toBe(8.5);
  });

  // ── Step 4: confirm_order ──────────────────────────────────────────────────

  it('step 4 — confirm_order confirms the order', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'confirm_order', {}, VAPI_RESTAURANT_ASSISTANT_ID),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const toolResult = results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`confirm_order failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(typeof toolResult.order_id).toBe('string');
    expect(toolResult.order_id.length).toBeGreaterThan(0);
    expect(toolResult.status).toBe('confirmed');
  });

  // ── Step 5: call and session exist ────────────────────────────────────────

  it('step 5 — call and session exist with correct identifiers', async () => {
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

  // ── Step 6: events exist for all webhook messages ─────────────────────────

  it('step 6 — events exist for status-update and all four tool invocations', async () => {
    const res    = await getVoiceCallEvents(TOKEN, internalCallId);
    const events = expectSuccess(res);

    expect(Array.isArray(events)).toBe(true);

    // status-update event(s) from call lifecycle must be present
    assertEventExists(events, 'call.status_update');

    // At least one tool.invoked event — 'tool-calls' maps to 'tool.invoked' in the event mapper
    assertEventExists(events, 'tool.invoked');

    // 1 status-update + 4 tool-calls webhooks = at least 5 persisted events
    expect(events.length).toBeGreaterThanOrEqual(5);
  });
});
