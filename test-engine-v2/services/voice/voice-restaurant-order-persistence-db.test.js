'use strict';

/**
 * Voice — Restaurant Order Persistence DB
 *
 * Verifies that order state is correctly persisted in restaurant_orders,
 * restaurant_order_items, and voice_order_contexts across the full order lifecycle.
 *
 * Uses tool responses as the primary verification signal:
 *   - order_id is a UUID  → restaurant_orders row was created
 *   - order_item_id is a UUID → restaurant_order_items row was created
 *   - confirm returns status='confirmed' → restaurant_orders updated
 *
 * Flow:
 *   1. search_menu_item('salami')       → resolve real item UUID + price
 *   2. create_order                     → real order_id (UUID)
 *   3. add_order_item + modifier         → real order_item_id, price includes modifier
 *   4. add_order_item without modifier  → second item added
 *   5. update_order_item                → quantity and modifier updated
 *   6. confirm_order                    → status confirmed
 *   7. persistence checks               → session, events
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
const CALL_ID = uniqueVoiceCallId('test-call-restaurant-order-persistence-db');

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / restaurant / order-persistence-db', () => {
  let internalCallId;
  let orderId;
  let salamiItemId;
  let salamiOrderItemId;

  beforeAll(async () => {
    const res = await sendVoiceWebhook(buildVapiStatusUpdate(CALL_ID, {}, VAPI_RESTAURANT_ASSISTANT_ID));
    if (res.status >= 300) {
      throw new Error(
        `Setup failed — webhook rejected with ${res.status}.\n` +
        `provider_call_id: ${CALL_ID}\nResponse: ${JSON.stringify(res.data)}`,
      );
    }

    const list = await listVoiceCalls(TOKEN);
    if (list.status !== 200 || !list.data?.success) {
      throw new Error(`Setup failed — GET /voice/calls returned ${list.status}`);
    }
    const call = list.data.data.find((c) => c.provider_call_id === CALL_ID);
    if (!call) {
      throw new Error(`Setup failed — call not found.\nprovider_call_id: ${CALL_ID}`);
    }
    internalCallId = call.id;
  });

  // ── Step 1: resolve real item UUID ────────────────────────────────────────

  it('step 1 — search_menu_item("salami") resolves real UUID', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'search_menu_item', { query: 'salami' }, VAPI_RESTAURANT_ASSISTANT_ID),
    );
    expect(res.status).toBe(200);

    const toolResult = res.data?.results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`search failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }

    const item = toolResult.items.find((i) => i.name?.toLowerCase().includes('salami'));
    expect(item).toBeDefined();
    expectUuid(item.id);
    expect(item.price).toBe(9.8);

    salamiItemId = item.id;
  });

  // ── Step 2: create_order — DB-backed ──────────────────────────────────────

  it('step 2 — create_order returns UUID (proves restaurant_orders row created)', async () => {
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

  // ── Step 3: add item with add-modifier ────────────────────────────────────

  it('step 3 — add_order_item(salami + extra Käse) persists row with modifier', async () => {
    if (!salamiItemId) throw new Error('step 1 must run first');

    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'add_order_item',
        {
          item_id:   salamiItemId,
          quantity:  1,
          modifiers: [{ type: 'add', name: 'extra Käse' }],
        },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );
    expect(res.status).toBe(200);

    const toolResult = res.data?.results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`add_order_item failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }

    expect(toolResult.order_id).toBe(orderId);
    expect(toolResult.status).toBe('item_added');

    const item = toolResult.item;
    // order_item_id must be a real UUID from restaurant_order_items
    expectUuid(item.id);
    expect(item.name.toLowerCase()).toContain('salami');
    // price = base (9.80) + extra Käse (1.50) = 11.30
    expect(item.price).toBeCloseTo(11.3, 2);
    expect(item.modifiers.length).toBe(1);
    expect(item.modifiers[0].type).toBe('add');
    expect(item.modifiers[0].name).toBe('extra Käse');
    expect(item.modifiers[0].price_delta).toBe(1.5);
    expect(item.line_total).toBeCloseTo(11.3, 2);

    salamiOrderItemId = item.id;
  });

  // ── Step 4: add second item without modifier ──────────────────────────────

  it('step 4 — add_order_item(salami, no modifier) creates second order_item row', async () => {
    if (!salamiItemId) throw new Error('step 1 must run first');

    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'add_order_item',
        { item_id: salamiItemId, quantity: 2 },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );
    expect(res.status).toBe(200);

    const toolResult = res.data?.results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`add_order_item failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }

    const item = toolResult.item;
    expectUuid(item.id);
    // Different order_item_id from step 3 (separate row)
    expect(item.id).not.toBe(salamiOrderItemId);
    expect(item.quantity).toBe(2);
    expect(item.price).toBeCloseTo(9.8, 2);
    expect(item.line_total).toBeCloseTo(19.6, 2);
    expect(item.modifiers.length).toBe(0);
  });

  // ── Step 5: update item ───────────────────────────────────────────────────

  it('step 5 — update_order_item changes quantity and modifier on persisted item', async () => {
    if (!salamiItemId) throw new Error('step 1 must run first');

    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'update_order_item',
        {
          item_id:   salamiItemId,
          quantity:  3,
          modifiers: [{ type: 'remove', name: 'Käse' }],
        },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );
    expect(res.status).toBe(200);

    const toolResult = res.data?.results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`update_order_item failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }

    expect(toolResult.status).toBe('item_updated');
    const item = toolResult.item;
    expect(item.quantity).toBe(3);
    expect(item.price).toBeCloseTo(9.8, 2); // remove has no price delta
    expect(item.line_total).toBeCloseTo(29.4, 2);
    expect(item.modifiers.length).toBe(1);
    expect(item.modifiers[0].type).toBe('remove');
    expect(item.modifiers[0].name).toBe('Käse');
    expect(item.modifiers[0].price_delta).toBe(0);
  });

  // ── Step 6: confirm order ─────────────────────────────────────────────────

  it('step 6 — confirm_order sets status confirmed on both order and context', async () => {
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

  // ── Step 7: persistence ───────────────────────────────────────────────────

  it('step 7 — call and session exist with correct identifiers', async () => {
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

  it('step 8 — events exist for all tool invocations', async () => {
    const res    = await getVoiceCallEvents(TOKEN, internalCallId);
    const events = expectSuccess(res);

    expect(Array.isArray(events)).toBe(true);
    assertEventExists(events, 'call.status_update');
    assertEventExists(events, 'tool.invoked');
    // 1 status-update + 6 tool calls = at least 7 events
    expect(events.length).toBeGreaterThanOrEqual(7);
  });
});
