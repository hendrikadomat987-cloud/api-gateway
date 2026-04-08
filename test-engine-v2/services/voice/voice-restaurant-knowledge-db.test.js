'use strict';

/**
 * Voice — Restaurant Knowledge DB
 *
 * Verifies the deterministic FAQ knowledge layer (Phase 4).
 * All answers are generated from real DB data — no stubs.
 *
 * Intents tested:
 *   A. opening_hours  — question about opening times
 *   B. delivery_area (valid PLZ)  — "Liefert ihr nach 50668?"
 *   C. delivery_area (invalid PLZ) — "Liefert ihr nach 99999?"
 *   D. min_order  — minimum order amount
 *   E. delivery_fee  — delivery fee query
 *   F. delivery_time  — ETA question
 *   G. fallback  — unknown question returns success without crashing
 *
 * Seed data:
 *   Delivery zones: 50667/50668 → Zone A 2,50 €, 50670/50672/50674 → Zone B 3,50 €
 *   Min order: 15,00 € across all zones
 *   Settings: ETA pickup 15–20 min, delivery 30–45 min
 */

const config = require('../../config/config');

const { sendVoiceWebhook, listVoiceCalls } = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_RESTAURANT_ASSISTANT_ID,
} = require('../../core/factories');

// ─────────────────────────────────────────────────────────────────────────────

jest.setTimeout(60000);

const TOKEN = config.tokens.tenantA;

// ── helpers ───────────────────────────────────────────────────────────────────

async function setupCall(callId) {
  const res = await sendVoiceWebhook(
    buildVapiStatusUpdate(callId, {}, VAPI_RESTAURANT_ASSISTANT_ID),
  );
  if (res.status >= 300) {
    throw new Error(`Setup failed for ${callId}: ${res.status} ${JSON.stringify(res.data)}`);
  }
  const list = await listVoiceCalls(TOKEN);
  const call = list.data?.data?.find((c) => c.provider_call_id === callId);
  if (!call) throw new Error(`Call not found after setup: ${callId}`);
  return call.id;
}

async function ask(callId, question) {
  const res = await sendVoiceWebhook(
    buildVapiToolCall(callId, 'answer_menu_question', { question }, VAPI_RESTAURANT_ASSISTANT_ID),
  );
  if (res.status !== 200) {
    throw new Error(`answer_menu_question HTTP ${res.status}: ${JSON.stringify(res.data)}`);
  }
  const results = res.data?.results;
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('answer_menu_question returned empty results');
  }
  return results[0].result;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / restaurant / knowledge-db', () => {
  // One call per describe block so tests are independent
  const CALL_ID = uniqueVoiceCallId('test-knowledge-db');

  beforeAll(() => setupCall(CALL_ID));

  // ── A: Opening hours ─────────────────────────────────────────────────────

  it('A — opening hours: answer contains time or "geöffnet"', async () => {
    const res = await ask(CALL_ID, 'Habt ihr geöffnet?');

    expect(res.success).toBe(true);
    expect(res.source).toBe('knowledge');
    expect(res.intent).toBe('opening_hours');
    expect(typeof res.answer).toBe('string');
    expect(res.answer.length).toBeGreaterThan(10);

    // Answer must contain either the word "geöffnet"/"geschlossen" or a time like "11:00"
    const containsTimeOrStatus =
      /ge[öo]ffnet|geschlossen|\d{1,2}:\d{2}/.test(res.answer);
    expect(containsTimeOrStatus).toBe(true);
  });

  // ── B: Delivery area — valid PLZ ─────────────────────────────────────────

  it('B — delivery area valid PLZ 50668: positive answer with fee', async () => {
    const res = await ask(CALL_ID, 'Liefert ihr nach 50668?');

    expect(res.success).toBe(true);
    expect(res.source).toBe('knowledge');
    expect(res.intent).toBe('delivery_area');
    expect(typeof res.answer).toBe('string');

    // Should confirm delivery is available
    expect(res.answer.toLowerCase()).toMatch(/ja|liefern/);
    // Should mention the PLZ
    expect(res.answer).toContain('50668');
    // Should mention a fee in euros
    expect(res.answer).toMatch(/\d+[,.]\d+\s*€/);
  });

  // ── C: Delivery area — invalid PLZ ───────────────────────────────────────

  it('C — delivery area invalid PLZ 99999: negative answer', async () => {
    const res = await ask(CALL_ID, 'Liefert ihr nach 99999?');

    expect(res.success).toBe(true);
    expect(res.source).toBe('knowledge');
    expect(res.intent).toBe('delivery_area');
    expect(typeof res.answer).toBe('string');

    // Should indicate no delivery
    const isNegative = /leider|nicht|kein/i.test(res.answer);
    expect(isNegative).toBe(true);
    // Should mention the PLZ
    expect(res.answer).toContain('99999');
  });

  // ── D: Min order ─────────────────────────────────────────────────────────

  it('D — min order: answer contains 15 (= 15,00 €)', async () => {
    const res = await ask(CALL_ID, 'Wie hoch ist der Mindestbestellwert?');

    expect(res.success).toBe(true);
    expect(res.source).toBe('knowledge');
    expect(res.intent).toBe('min_order');
    expect(typeof res.answer).toBe('string');

    // Seed data: min_order_cents = 1500 → 15,00 €
    expect(res.answer).toMatch(/15/);
    expect(res.answer).toMatch(/€/);
    // Metadata check
    expect(res.metadata?.min_order_cents).toBe(1500);
  });

  // ── E: Delivery fee ──────────────────────────────────────────────────────

  it('E — delivery fee: answer contains correct fee range', async () => {
    const res = await ask(CALL_ID, 'Was kostet die Lieferung?');

    expect(res.success).toBe(true);
    expect(res.source).toBe('knowledge');
    expect(res.intent).toBe('delivery_fee');
    expect(typeof res.answer).toBe('string');

    // Zone A: 2,50 € — should appear in answer
    expect(res.answer).toMatch(/2[,.]50/);
    expect(res.answer).toMatch(/€/);
  });

  it('E2 — delivery fee for specific PLZ 50667: exact fee 2,50 €', async () => {
    const res = await ask(CALL_ID, 'Was kostet die Lieferung nach 50667?');

    expect(res.success).toBe(true);
    expect(res.source).toBe('knowledge');
    expect(res.intent).toBe('delivery_fee');
    // Zone A fee is exactly 2,50 €
    expect(res.answer).toMatch(/2[,.]50/);
    expect(res.answer).toContain('50667');
  });

  // ── F: ETA / delivery time ───────────────────────────────────────────────

  it('F — delivery time: answer contains minute range', async () => {
    const res = await ask(CALL_ID, 'Wie lange dauert die Lieferung?');

    expect(res.success).toBe(true);
    expect(res.source).toBe('knowledge');
    expect(res.intent).toBe('delivery_time');
    expect(typeof res.answer).toBe('string');

    // Should mention minutes (e.g. "30–45 Minuten")
    expect(res.answer).toMatch(/\d+.{0,5}Minute/i);
    // Metadata should have delivery range
    expect(typeof res.metadata?.delivery_min).toBe('number');
    expect(typeof res.metadata?.delivery_max).toBe('number');
    expect(res.metadata.delivery_max).toBeGreaterThan(res.metadata.delivery_min);
  });

  // ── G: Fallback (unknown question) ───────────────────────────────────────

  it('G — fallback: unknown question returns success with fallback source', async () => {
    const res = await ask(CALL_ID, 'Habt ihr einen Parkplatz?');

    expect(res.success).toBe(true);
    expect(typeof res.answer).toBe('string');
    expect(res.answer.length).toBeGreaterThan(5);
    // Should indicate this was a fallback (no knowledge match)
    expect(res.source).toBe('fallback');
  });
});
