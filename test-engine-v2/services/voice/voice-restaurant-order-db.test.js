'use strict';

/**
 * Voice — Restaurant Order DB Regression
 *
 * Validates the order happy-path using real DB-backed tools (Phase 2).
 * Fetches the real Margherita UUID via search, then runs the full order flow.
 *
 * Flow:
 *   1. search_menu_item('margherita')  → resolve real item UUID + price
 *   2. create_order                    → real UUID order_id returned
 *   3. add_order_item(real UUID)       → order_item_id is UUID, name/price from DB
 *   4. confirm_order                   → order confirmed
 *   5. persistence                     → call, session, events consistent
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
  let margheritaItemId; // real UUID from DB

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

  // ── Step 0: resolve real Margherita UUID from DB ───────────────────────────

  it('step 0 — search_menu_item resolves real Margherita UUID and price', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'search_menu_item', { query: 'margherita' }, VAPI_RESTAURANT_ASSISTANT_ID),
    );

    expect(res.status).toBe(200);
    const toolResult = res.data?.results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`search_menu_item failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }

    const item = toolResult.items.find((i) => i.name?.toLowerCase().includes('margherita'));
    expect(item).toBeDefined();
    expect(item.price).toBe(8.5);
    expectUuid(item.id);

    margheritaItemId = item.id;
  });

  // ── Step 1: create_order — returns real UUID ───────────────────────────────

  it('step 1 — create_order returns a real UUID order_id', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'create_order', {}, VAPI_RESTAURANT_ASSISTANT_ID),
    );

    expect(res.status).toBe(200);

    const toolResult = res.data?.results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`create_order failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expectUuid(toolResult.order_id);
    expect(toolResult.status).toBe('created');

    orderId = toolResult.order_id;
  });

  // ── Step 2: add_order_item with real UUID ─────────────────────────────────

  it('step 2 — add_order_item with real UUID returns DB-backed item data', async () => {
    if (!margheritaItemId) throw new Error('step 0 must run first');

    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'add_order_item',
        { item_id: margheritaItemId, quantity: 1 },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );

    expect(res.status).toBe(200);

    const toolResult = res.data?.results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`add_order_item failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(toolResult.order_id).toBe(orderId);
    expect(toolResult.status).toBe('item_added');

    // Item data must come from real DB row
    const item = toolResult.item;
    expect(item).toBeDefined();
    // order_item_id is the UUID of the restaurant_order_items row
    expectUuid(item.id);
    expect(item.name.toLowerCase()).toContain('margherita');
    expect(item.price).toBe(8.5);
    expect(item.quantity).toBe(1);
    expect(Array.isArray(item.modifiers)).toBe(true);
    expect(item.modifiers.length).toBe(0);
    expect(item.line_total).toBe(8.5);
  });

  // ── Step 3: confirm_order ──────────────────────────────────────────────────

  it('step 3 — confirm_order finalises the order', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'confirm_order', {}, VAPI_RESTAURANT_ASSISTANT_ID),
    );

    expect(res.status).toBe(200);

    const toolResult = res.data?.results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`confirm_order failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(toolResult.order_id).toBe(orderId);
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

  it('step 5 — events exist for status-update and all tool invocations', async () => {
    const res    = await getVoiceCallEvents(TOKEN, internalCallId);
    const events = expectSuccess(res);

    expect(Array.isArray(events)).toBe(true);
    assertEventExists(events, 'call.status_update');
    assertEventExists(events, 'tool.invoked');
    // 1 status-update + 4 tool calls (search + create + add + confirm) = at least 5 events
    expect(events.length).toBeGreaterThanOrEqual(5);
  });
});
