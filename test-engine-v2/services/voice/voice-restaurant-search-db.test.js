'use strict';

/**
 * Voice — Restaurant Search DB Regression
 *
 * Validates search_menu_item against real DB data for tenant 11111111-...
 *
 *   1. 'margherita' query → Margherita pizza found with correct price
 *   2. 'cola' query       → Cola drink found with correct price
 *   3. 'burger' query     → no results (no hallucinated item)
 *
 * All search assertions use item names (not slug IDs) since DB IDs are UUIDs.
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
const CALL_ID = uniqueVoiceCallId('test-call-restaurant-search-db');

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / restaurant / search-db', () => {
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

  // ── Step 1: known pizza item search ───────────────────────────────────────

  it('step 1 — search_menu_item("margherita") finds Margherita (8.50)', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'search_menu_item',
        { query: 'margherita' },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    const toolResult = results[0].result;

    if (toolResult.success !== true) {
      throw new Error(`search_menu_item("margherita") failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(toolResult.query).toBe('margherita');
    expect(Array.isArray(toolResult.items)).toBe(true);

    const margherita = toolResult.items.find(
      (i) => i.name?.toLowerCase().includes('margherita'),
    );
    expect(margherita).toBeDefined();
    expect(typeof margherita.id).toBe('string');
    expect(margherita.price).toBe(8.5);
    expect(typeof margherita.category).toBe('string');
  });

  // ── Step 2: known drink search ────────────────────────────────────────────

  it('step 2 — search_menu_item("cola") finds Coca-Cola 0,33l (2.80)', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'search_menu_item',
        { query: 'cola' },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    const toolResult = results[0].result;

    if (toolResult.success !== true) {
      throw new Error(`search_menu_item("cola") failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(Array.isArray(toolResult.items)).toBe(true);

    const cola = toolResult.items.find(
      (i) => i.name?.toLowerCase().includes('cola'),
    );
    expect(cola).toBeDefined();
    expect(typeof cola.id).toBe('string');
    expect(cola.price).toBe(2.8);
  });

  // ── Step 3: out-of-menu — no hallucination guard ──────────────────────────

  it('step 3 — search_menu_item("burger") returns no items (no hallucination)', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'search_menu_item',
        { query: 'burger' },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    const toolResult = results[0].result;

    // Tool must respond without crashing
    expect(typeof toolResult.success).toBe('boolean');
    expect(Array.isArray(toolResult.items)).toBe(true);

    // No burger item may appear — the restaurant does not serve burgers
    const burgerItem = toolResult.items.find(
      (i) =>
        i.name?.toLowerCase().includes('burger') ||
        i.id?.toLowerCase().includes('burger'),
    );
    expect(burgerItem).toBeUndefined();

    // For a real DB with no burger row, the result set must be empty
    expect(toolResult.items.length).toBe(0);
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
    // 1 status-update + 3 search tool calls = at least 4 events
    expect(events.length).toBeGreaterThanOrEqual(4);
  });
});
