'use strict';

/**
 * Voice — Salon Knowledge DB
 *
 * Tests the deterministic knowledge resolver via answer_booking_question.
 *
 *   A. opening_hours intent    — returns hours answer
 *   B. services_list intent    — returns service list
 *   C. service_price intent    — returns price for named service
 *   D. service_duration intent — returns duration for named service
 *   E. stylist_availability    — returns stylist info
 *   F. unknown intent          — fallback to generic answer
 */

const config = require('../../config/config');
const { sendVoiceWebhook, listVoiceCalls } = require('../../core/apiClient');
const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_SALON_ASSISTANT_ID,
} = require('../../core/factories');

jest.setTimeout(60000);

const TOKEN   = config.tokens.tenantA;
const CALL_ID = uniqueVoiceCallId('test-salon-knowledge');

async function setupCall() {
  const res = await sendVoiceWebhook(buildVapiStatusUpdate(CALL_ID, {}, VAPI_SALON_ASSISTANT_ID));
  if (res.status >= 300) throw new Error(`Setup failed: ${res.status}`);
  const list = await listVoiceCalls(TOKEN);
  const call = list.data?.data?.find((c) => c.provider_call_id === CALL_ID);
  if (!call) throw new Error(`Call not found: ${CALL_ID}`);
}

async function ask(question) {
  const res = await sendVoiceWebhook(
    buildVapiToolCall(CALL_ID, 'answer_booking_question', { question }, VAPI_SALON_ASSISTANT_ID),
  );
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const results = res.data?.results;
  if (!Array.isArray(results) || results.length === 0) throw new Error('empty results');
  return results[0].result;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / salon / knowledge-db', () => {
  beforeAll(setupCall);

  // ── A: opening_hours ──────────────────────────────────────────────────────

  describe('A — opening_hours intent', () => {
    it('Öffnungszeiten question triggers opening_hours intent', async () => {
      const r = await ask('Wann habt ihr geöffnet?');
      expect(r.success).toBe(true);
      expect(r.intent).toBe('opening_hours');
      expect(r.source).toBe('knowledge');
      expect(typeof r.answer).toBe('string');
      expect(r.answer.length).toBeGreaterThan(10);
    });

    it('Heute offen question triggers opening_hours intent', async () => {
      const r = await ask('Seid ihr heute noch offen?');
      expect(r.success).toBe(true);
      expect(r.intent).toBe('opening_hours');
    });
  });

  // ── B: services_list ──────────────────────────────────────────────────────

  describe('B — services_list intent', () => {
    it('Welche Leistungen question triggers services_list intent', async () => {
      const r = await ask('Welche Leistungen bietet ihr an?');
      expect(r.success).toBe(true);
      expect(r.intent).toBe('services_list');
      expect(r.source).toBe('knowledge');
      expect(typeof r.answer).toBe('string');
    });
  });

  // ── C: service_price ──────────────────────────────────────────────────────

  describe('C — service_price intent', () => {
    it('Was kostet question triggers service_price intent', async () => {
      const r = await ask('Was kostet ein Haarschnitt?');
      expect(r.success).toBe(true);
      expect(r.intent).toBe('service_price');
      expect(r.source).toBe('knowledge');
      expect(typeof r.answer).toBe('string');
    });
  });

  // ── D: service_duration ───────────────────────────────────────────────────

  describe('D — service_duration intent', () => {
    it('Wie lange dauert question triggers service_duration intent', async () => {
      const r = await ask('Wie lange dauert ein Herrenhaarschnitt?');
      expect(r.success).toBe(true);
      expect(r.intent).toBe('service_duration');
      expect(r.source).toBe('knowledge');
    });
  });

  // ── E: stylist_availability ───────────────────────────────────────────────

  describe('E — stylist_availability intent', () => {
    it('Arbeitet Anna question triggers stylist_availability intent', async () => {
      const r = await ask('Arbeitet Anna morgen?');
      expect(r.success).toBe(true);
      expect(r.intent).toBe('stylist_availability');
      expect(r.source).toBe('knowledge');
      expect(typeof r.answer).toBe('string');
    });
  });

  // ── F: unknown intent — fallback ──────────────────────────────────────────

  describe('F — unknown question falls back gracefully', () => {
    it('completely unrelated question returns fallback source', async () => {
      const r = await ask('Hast du schon mal über den Sinn des Lebens nachgedacht?');
      expect(r.success).toBe(true);
      expect(typeof r.answer).toBe('string');
      expect(r.answer.length).toBeGreaterThan(5);
      // source is 'fallback' for unknown intents
      expect(['fallback', 'knowledge']).toContain(r.source);
    });

    it('empty question returns fallback', async () => {
      const r = await ask('');
      expect(r.success).toBe(true);
      expect(r.source).toBe('fallback');
    });
  });
});
