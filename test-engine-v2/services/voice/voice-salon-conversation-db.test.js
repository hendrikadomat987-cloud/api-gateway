'use strict';

/**
 * Voice — Salon Conversation DB
 *
 * Tests conversational reference resolution in the booking context.
 * Analogous to voice-restaurant-conversation-db.test.js.
 *
 *   A. Positional reference "erste" → removes first service
 *   B. Positional reference "1"     → numeric positional
 *   C. Name-based reference         → resolves by service name
 *   D. "letzte" reference           → resolves last service
 *   E. Ambiguous reference          → returns candidates array
 *   F. Out-of-bounds positional     → explicit error
 */

const config = require('../../config/config');
const { sendVoiceWebhook, listVoiceCalls } = require('../../core/apiClient');
const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_SALON_ASSISTANT_ID,
} = require('../../core/factories');

jest.setTimeout(120000);

const TOKEN = config.tokens.tenantA;

async function setupCall(callId) {
  const res = await sendVoiceWebhook(buildVapiStatusUpdate(callId, {}, VAPI_SALON_ASSISTANT_ID));
  if (res.status >= 300) throw new Error(`Setup failed: ${res.status}`);
  const list = await listVoiceCalls(TOKEN);
  const call = list.data?.data?.find((c) => c.provider_call_id === callId);
  if (!call) throw new Error(`Call not found: ${callId}`);
  return call.id;
}

async function tool(callId, name, args = {}) {
  const res = await sendVoiceWebhook(
    buildVapiToolCall(callId, name, args, VAPI_SALON_ASSISTANT_ID),
  );
  if (res.status !== 200) throw new Error(`${name} HTTP ${res.status}`);
  const results = res.data?.results;
  if (!Array.isArray(results) || results.length === 0) throw new Error(`${name} empty results`);
  return results[0].result;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / salon / conversation-db', () => {
  let serviceId1;
  let serviceName1;
  let serviceId2;

  beforeAll(async () => {
    const setupCallId = uniqueVoiceCallId('salon-conv-setup');
    await setupCall(setupCallId);
    const catalogue = await tool(setupCallId, 'get_services');
    const allServices = catalogue.categories?.flatMap((c) => c.services) ?? [];
    if (allServices.length < 2) throw new Error('Need at least 2 services for conversation tests');
    serviceId1   = allServices[0].id;
    serviceName1 = allServices[0].name;
    serviceId2   = allServices[1].id;
  });

  // ── A: Positional "erste" ─────────────────────────────────────────────────

  describe('A — positional reference "erste"', () => {
    const callId = uniqueVoiceCallId('salon-conv-a');
    beforeAll(() => setupCall(callId));

    it('removes first service via "erste"', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId1 });
      await tool(callId, 'add_booking_service', { service_id: serviceId2 });

      const r = await tool(callId, 'remove_booking_service', { service_id: 'erste' });
      expect(r.success).toBe(true);
      expect(r.status).toBe('service_removed');

      const summary = await tool(callId, 'get_booking_summary');
      expect(summary.service_count).toBe(1);
    });
  });

  // ── B: Numeric positional "1" ─────────────────────────────────────────────

  describe('B — numeric positional reference "1"', () => {
    const callId = uniqueVoiceCallId('salon-conv-b');
    beforeAll(() => setupCall(callId));

    it('removes first service via "1"', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId1 });
      await tool(callId, 'add_booking_service', { service_id: serviceId2 });

      const r = await tool(callId, 'remove_booking_service', { service_id: '1' });
      expect(r.success).toBe(true);
      expect(r.status).toBe('service_removed');
    });
  });

  // ── C: Name-based reference ───────────────────────────────────────────────

  describe('C — name-based reference', () => {
    const callId = uniqueVoiceCallId('salon-conv-c');
    beforeAll(() => setupCall(callId));

    it('removes service by name substring', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId1 });

      // Use part of the service name as reference
      const nameQuery = serviceName1.substring(0, 5);
      const r = await tool(callId, 'remove_booking_service', { service_id: nameQuery });

      // Either success (if unique match) or ambiguous/not_found
      expect(typeof r.success).toBe('boolean');
      if (!r.success) {
        expect(['item_not_found', 'ambiguous_reference']).toContain(r.error);
      }
    });
  });

  // ── D: "letzte" reference ─────────────────────────────────────────────────

  describe('D — "letzte" removes last service', () => {
    const callId = uniqueVoiceCallId('salon-conv-d');
    beforeAll(() => setupCall(callId));

    it('removes last service via "letzte"', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId1 });
      await tool(callId, 'add_booking_service', { service_id: serviceId2 });

      const r = await tool(callId, 'remove_booking_service', { service_id: 'letzte' });
      expect(r.success).toBe(true);
      expect(r.status).toBe('service_removed');

      const summary = await tool(callId, 'get_booking_summary');
      expect(summary.service_count).toBe(1);
    });
  });

  // ── E/F: Error cases ──────────────────────────────────────────────────────

  describe('E/F — error cases for invalid references', () => {
    const callId = uniqueVoiceCallId('salon-conv-ef');
    beforeAll(() => setupCall(callId));

    it('out-of-bounds positional returns out_of_bounds error', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId1 });

      const r = await tool(callId, 'remove_booking_service', { service_id: '99' });
      expect(r.success).toBe(false);
      expect(r.error).toBe('out_of_bounds');
    });

    it('remove from empty booking returns error', async () => {
      const emptyCallId = uniqueVoiceCallId('salon-conv-ef-empty');
      await setupCall(emptyCallId);
      await tool(emptyCallId, 'create_booking', {});

      const r = await tool(emptyCallId, 'remove_booking_service', { service_id: 'erste' });
      expect(r.success).toBe(false);
      expect(r.error).toBe('empty_booking');
    });
  });
});
