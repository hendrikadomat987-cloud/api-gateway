'use strict';

/**
 * Voice — Restaurant Modifier DB Regression
 *
 * Validates modifier support in add_order_item and update_order_item
 * against the real restaurant_menu_modifiers catalog in the DB.
 *
 * Modifier catalog (seeded for tenant 11111111-...):
 *   add:       extra Käse (+1.50), Champignons (+1.20), Jalapeños (+1.00)
 *   remove:    Zwiebeln (0), Käse (0), Knoblauch (0)
 *   free_text: extra knusprig (0), Sauce separat (0)
 *
 * Test cases:
 *   1. add_order_item with add-modifier    → modifier present, price_delta correct
 *   2. add_order_item with remove-modifier → modifier present, price_delta = 0
 *   3. add_order_item with free_text       → modifier present, price_delta = 0
 *   4. add_order_item with unknown add-modifier → error: modifier_not_found
 *   5. update_order_item with modifiers    → modifiers replaced correctly
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
const CALL_ID = uniqueVoiceCallId('test-call-restaurant-modifiers-db');

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / restaurant / modifiers-db', () => {
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

  // ── Step 1: add modifier (add-type) ───────────────────────────────────────

  it('step 1 — add_order_item with add-modifier "extra Käse" resolves from catalog', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'add_order_item',
        {
          item_id:   'pizza_margherita',
          quantity:  1,
          modifiers: [{ type: 'add', name: 'extra Käse' }],
        },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    const toolResult = results[0].result;

    if (toolResult.success !== true) {
      throw new Error(`add_order_item with add-modifier failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(toolResult.status).toBe('item_added');
    expect(toolResult.item).toBeDefined();

    const modifiers = toolResult.item.modifiers;
    expect(Array.isArray(modifiers)).toBe(true);
    expect(modifiers.length).toBe(1);

    const mod = modifiers[0];
    expect(mod.type).toBe('add');
    expect(mod.name).toBe('extra Käse');
    expect(mod.price_delta).toBe(1.5);
    expect(typeof mod.modifier_id).toBe('string');
    expect(mod.modifier_id.length).toBeGreaterThan(0);
  });

  // ── Step 2: remove modifier ───────────────────────────────────────────────

  it('step 2 — add_order_item with remove-modifier "Käse" → price_delta = 0', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'add_order_item',
        {
          item_id:   'pizza_salami',
          quantity:  1,
          modifiers: [{ type: 'remove', name: 'Käse' }],
        },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );

    expect(res.status).toBe(200);

    const toolResult = res.data?.results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`add_order_item with remove-modifier failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);

    const modifiers = toolResult.item.modifiers;
    expect(Array.isArray(modifiers)).toBe(true);
    expect(modifiers.length).toBe(1);

    const mod = modifiers[0];
    expect(mod.type).toBe('remove');
    expect(mod.name).toBe('Käse');
    expect(mod.price_delta).toBe(0);
    expect(typeof mod.modifier_id).toBe('string');
  });

  // ── Step 3: free_text modifier ────────────────────────────────────────────

  it('step 3 — add_order_item with free_text modifier "extra knusprig" → accepted, price_delta = 0', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'add_order_item',
        {
          item_id:   'pizza_margherita',
          quantity:  1,
          modifiers: [{ type: 'free_text', name: 'extra knusprig' }],
        },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );

    expect(res.status).toBe(200);

    const toolResult = res.data?.results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`add_order_item with free_text modifier failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);

    const modifiers = toolResult.item.modifiers;
    expect(Array.isArray(modifiers)).toBe(true);
    expect(modifiers.length).toBe(1);

    const mod = modifiers[0];
    expect(mod.type).toBe('free_text');
    expect(mod.name).toBe('extra knusprig');
    expect(mod.price_delta).toBe(0);
    // free_text modifiers have no catalog ID
    expect(mod.modifier_id).toBeUndefined();
  });

  // ── Step 4: unknown modifier → error ─────────────────────────────────────

  it('step 4 — add_order_item with unknown add-modifier returns modifier_not_found', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'add_order_item',
        {
          item_id:   'pizza_margherita',
          quantity:  1,
          modifiers: [{ type: 'add', name: 'Trüffel' }],
        },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );

    expect(res.status).toBe(200);

    const toolResult = res.data?.results[0].result;
    // Must return a structured error — not crash
    expect(typeof toolResult.success).toBe('boolean');
    expect(toolResult.success).toBe(false);
    expect(toolResult.error).toBe('modifier_not_found');
    expect(toolResult.modifier).toBe('Trüffel');
  });

  // ── Step 5: multiple modifiers in one call ────────────────────────────────

  it('step 5 — add_order_item with mixed modifiers (add + remove) all resolve', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'add_order_item',
        {
          item_id:   'pizza_margherita',
          quantity:  1,
          modifiers: [
            { type: 'add',    name: 'extra Käse' },
            { type: 'remove', name: 'Zwiebeln'   },
          ],
        },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );

    expect(res.status).toBe(200);

    const toolResult = res.data?.results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`add_order_item with mixed modifiers failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);

    const modifiers = toolResult.item.modifiers;
    expect(Array.isArray(modifiers)).toBe(true);
    expect(modifiers.length).toBe(2);

    const addMod = modifiers.find((m) => m.type === 'add');
    expect(addMod).toBeDefined();
    expect(addMod.name).toBe('extra Käse');
    expect(addMod.price_delta).toBe(1.5);

    const removeMod = modifiers.find((m) => m.type === 'remove');
    expect(removeMod).toBeDefined();
    expect(removeMod.name).toBe('Zwiebeln');
    expect(removeMod.price_delta).toBe(0);
  });

  // ── Step 6: update_order_item with modifier replacement ───────────────────

  it('step 6 — update_order_item with modifiers replaces modifier list', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'update_order_item',
        {
          item_id:   'pizza_margherita',
          quantity:  2,
          modifiers: [{ type: 'add', name: 'Champignons' }],
        },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );

    expect(res.status).toBe(200);

    const toolResult = res.data?.results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`update_order_item with modifiers failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(toolResult.status).toBe('item_updated');
    expect(toolResult.item.quantity).toBe(2);

    const modifiers = toolResult.item.modifiers;
    expect(Array.isArray(modifiers)).toBe(true);
    expect(modifiers.length).toBe(1);

    const mod = modifiers[0];
    expect(mod.type).toBe('add');
    expect(mod.name).toBe('Champignons');
    expect(mod.price_delta).toBe(1.2);
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

  it('step 8 — events exist for status-update and all modifier tool invocations', async () => {
    const res    = await getVoiceCallEvents(TOKEN, internalCallId);
    const events = expectSuccess(res);

    expect(Array.isArray(events)).toBe(true);
    assertEventExists(events, 'call.status_update');
    assertEventExists(events, 'tool.invoked');
    // 1 status-update + 6 tool calls = at least 7 events
    expect(events.length).toBeGreaterThanOrEqual(7);
  });
});
