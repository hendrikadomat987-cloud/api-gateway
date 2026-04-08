'use strict';

/**
 * Voice — Restaurant Order DB Regression
 *
 * Validates the order happy-path using explicit Vapi-style args (item_id, quantity).
 * Real Vapi tool calls always send args as a JSON object or JSON string.
 * This test ensures the tool handler accepts explicit args without crashing
 * and returns data consistent with the requested item.
 *
 * Flow:
 *   1. create_order                      → order_id returned
 *   2. add_order_item(pizza_margherita)  → item added with correct data
 *   3. confirm_order                     → order confirmed
 *   4. persistence                       → call, session, events consistent
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
const CALL_ID = uniqueVoiceCallId('test-call-restaurant-order-db');

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / restaurant / order-db', () => {
  let internalCallId;
  let orderId;

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

  // ── Step 1: create_order ───────────────────────────────────────────────────

  it('step 1 — create_order returns a valid order_id', async () => {
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

    orderId = toolResult.order_id;
  });

  // ── Step 2: add_order_item with explicit args ──────────────────────────────
  // Real Vapi sends item_id and quantity as structured args.
  // This validates that the tool handler accepts args without crashing
  // and returns the correct item data for Margherita pizza.

  it('step 2 — add_order_item with explicit item_id arg returns Margherita', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'add_order_item',
        { item_id: 'pizza_margherita', quantity: 1 },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
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
    expect(toolResult.status).toBe('item_added');

    // Item data must match the requested Margherita pizza
    expect(toolResult.item).toBeDefined();
    expect(toolResult.item.id).toBe('pizza_margherita');
    expect(toolResult.item.name).toBe('Margherita');
    expect(toolResult.item.price).toBe(8.5);
    expect(typeof toolResult.item.quantity).toBe('number');
    expect(toolResult.item.quantity).toBeGreaterThan(0);
  });

  // ── Step 3: confirm_order ──────────────────────────────────────────────────

  it('step 3 — confirm_order finalises the order', async () => {
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
    expect(toolResult.status).toBe('confirmed');
  });

  // ── Step 4: persistence ────────────────────────────────────────────────────

  it('step 4 — call and session exist with correct identifiers', async () => {
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

  it('step 5 — events exist for status-update and all three tool invocations', async () => {
    const res    = await getVoiceCallEvents(TOKEN, internalCallId);
    const events = expectSuccess(res);

    expect(Array.isArray(events)).toBe(true);
    assertEventExists(events, 'call.status_update');
    assertEventExists(events, 'tool.invoked');
    // 1 status-update + 3 tool calls = at least 4 persisted events
    expect(events.length).toBeGreaterThanOrEqual(4);
  });
});
