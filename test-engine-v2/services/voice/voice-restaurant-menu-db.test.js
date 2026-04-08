'use strict';

/**
 * Voice — Restaurant Menu DB Regression
 *
 * Validates that get_menu returns the full expected menu inventory from the DB.
 * All assertions are name- and price-based so they are stable across DB migrations
 * (IDs are UUIDs from the DB, not slugs).
 *
 * Expected inventory for tenant 11111111-1111-1111-1111-111111111111:
 *   Pizzen:   Pizza Margherita (8.50), Pizza Salami (9.80)
 *   Getränke: Coca-Cola 0,33l (2.80)
 *
 * Flow:
 *   1. get_menu      → full inventory (Pizza + Drinks categories, all items)
 *   2. persistence   → call, session, events consistent
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
const CALL_ID = uniqueVoiceCallId('test-call-restaurant-menu-db');

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / restaurant / menu-db', () => {
  let internalCallId;
  let menuCategories;

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

  // ── Step 1: get_menu — full DB inventory check ─────────────────────────────

  it('step 1 — get_menu returns a non-empty menu from DB', async () => {
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

    menuCategories = toolResult.categories;
  });

  it('step 1a — Pizzen category contains Pizza Margherita (8.50) and Pizza Salami (9.80)', () => {
    if (!menuCategories) throw new Error('step 1 must run first');

    const pizzaCat = menuCategories.find((c) => c.name === 'Pizzen');
    expect(pizzaCat).toBeDefined();
    expect(Array.isArray(pizzaCat.items)).toBe(true);

    const margherita = pizzaCat.items.find((i) => i.name === 'Pizza Margherita');
    expect(margherita).toBeDefined();
    expect(typeof margherita.id).toBe('string');
    expect(margherita.id.length).toBeGreaterThan(0);
    expect(margherita.price).toBe(8.5);

    const salami = pizzaCat.items.find((i) => i.name === 'Pizza Salami');
    expect(salami).toBeDefined();
    expect(typeof salami.id).toBe('string');
    expect(salami.price).toBe(9.8);
  });

  it('step 1b — Getränke category contains Coca-Cola 0,33l (2.80)', () => {
    if (!menuCategories) throw new Error('step 1 must run first');

    const drinksCat = menuCategories.find((c) => c.name === 'Getränke');
    expect(drinksCat).toBeDefined();
    expect(Array.isArray(drinksCat.items)).toBe(true);

    const cola = drinksCat.items.find((i) => i.name === 'Coca-Cola 0,33l');
    expect(cola).toBeDefined();
    expect(typeof cola.id).toBe('string');
    expect(cola.price).toBe(2.8);
  });

  it('step 1c — every item has a valid id, name, and numeric price', () => {
    if (!menuCategories) throw new Error('step 1 must run first');

    for (const category of menuCategories) {
      expect(typeof category.name).toBe('string');
      expect(category.name.length).toBeGreaterThan(0);
      for (const item of category.items) {
        expect(typeof item.id).toBe('string');
        expect(item.id.length).toBeGreaterThan(0);
        expect(typeof item.name).toBe('string');
        expect(item.name.length).toBeGreaterThan(0);
        expect(typeof item.price).toBe('number');
        expect(item.price).toBeGreaterThan(0);
      }
    }
  });

  // ── Step 2: persistence ────────────────────────────────────────────────────

  it('step 2 — call and session exist with correct identifiers', async () => {
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

  it('step 3 — events exist for status-update and tool invocation', async () => {
    const res    = await getVoiceCallEvents(TOKEN, internalCallId);
    const events = expectSuccess(res);

    expect(Array.isArray(events)).toBe(true);
    assertEventExists(events, 'call.status_update');
    assertEventExists(events, 'tool.invoked');
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});
