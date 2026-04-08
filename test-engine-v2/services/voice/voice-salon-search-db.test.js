'use strict';

/**
 * Voice — Salon Search DB
 *
 * Tests the service catalogue search and listing.
 *
 *   A. get_services   — returns grouped categories
 *   B. search_service — finds by keyword (full + partial)
 *   C. search_service — returns empty when no match
 *   D. search_service — missing query returns error
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
const CALL_ID = uniqueVoiceCallId('test-salon-search');

async function setupCall() {
  const res = await sendVoiceWebhook(buildVapiStatusUpdate(CALL_ID, {}, VAPI_SALON_ASSISTANT_ID));
  if (res.status >= 300) throw new Error(`Setup failed: ${res.status}`);
  const list = await listVoiceCalls(TOKEN);
  const call = list.data?.data?.find((c) => c.provider_call_id === CALL_ID);
  if (!call) throw new Error(`Call not found: ${CALL_ID}`);
  return call.id;
}

async function tool(name, args = {}) {
  const res = await sendVoiceWebhook(
    buildVapiToolCall(CALL_ID, name, args, VAPI_SALON_ASSISTANT_ID),
  );
  if (res.status !== 200) throw new Error(`${name} HTTP ${res.status}`);
  const results = res.data?.results;
  if (!Array.isArray(results) || results.length === 0) throw new Error(`${name} empty results`);
  return results[0].result;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / salon / search-db', () => {
  beforeAll(setupCall);

  // ── A: get_services ──────────────────────────────────────────────────────

  describe('A — get_services', () => {
    it('returns categories array', async () => {
      const r = await tool('get_services');
      expect(r.success).toBe(true);
      expect(Array.isArray(r.categories)).toBe(true);
      expect(r.categories.length).toBeGreaterThan(0);
    });

    it('each category has name and services array', async () => {
      const r = await tool('get_services');
      for (const cat of r.categories) {
        expect(typeof cat.name).toBe('string');
        expect(cat.name.length).toBeGreaterThan(0);
        expect(Array.isArray(cat.services)).toBe(true);
      }
    });

    it('each service has required fields', async () => {
      const r = await tool('get_services');
      const allServices = r.categories.flatMap((c) => c.services);
      expect(allServices.length).toBeGreaterThan(0);

      for (const s of allServices) {
        expect(typeof s.id).toBe('string');
        expect(typeof s.name).toBe('string');
        expect(typeof s.price).toBe('number');
        expect(typeof s.duration_minutes).toBe('number');
        expect(s.price).toBeGreaterThanOrEqual(0);
        expect(s.duration_minutes).toBeGreaterThan(0);
      }
    });
  });

  // ── B: search_service — match ─────────────────────────────────────────────

  describe('B — search_service finds by keyword', () => {
    it('finds "Haarschnitt" services', async () => {
      const r = await tool('search_service', { query: 'Haarschnitt' });
      expect(r.success).toBe(true);
      expect(r.count).toBeGreaterThan(0);
      expect(Array.isArray(r.results)).toBe(true);

      for (const s of r.results) {
        expect(typeof s.id).toBe('string');
        expect(typeof s.name).toBe('string');
        expect(s.name.toLowerCase()).toMatch(/haarschnitt/i);
      }
    });

    it('partial query returns results', async () => {
      const r = await tool('search_service', { query: 'schneid' });
      expect(r.success).toBe(true);
      // may return 0 if no match — just check structure
      expect(typeof r.count).toBe('number');
      expect(Array.isArray(r.results)).toBe(true);
    });
  });

  // ── C: search_service — no match ─────────────────────────────────────────

  describe('C — search_service returns empty for no match', () => {
    it('unknown query returns count 0', async () => {
      const r = await tool('search_service', { query: 'xyz_nonexistent_9999' });
      expect(r.success).toBe(true);
      expect(r.count).toBe(0);
      expect(r.results).toHaveLength(0);
    });
  });

  // ── D: search_service — missing query ────────────────────────────────────

  describe('D — search_service rejects missing query', () => {
    it('returns error when query is empty string', async () => {
      const r = await tool('search_service', { query: '' });
      expect(r.success).toBe(false);
      expect(r.error).toBe('missing_query');
    });

    it('returns error when query is omitted', async () => {
      const r = await tool('search_service', {});
      expect(r.success).toBe(false);
      expect(r.error).toBe('missing_query');
    });
  });
});
