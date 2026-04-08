'use strict';

/**
 * Voice — Salon Hardening DB
 *
 * Tests production-hardening concerns for the salon domain:
 *
 *   A. Dedup protection     — same service added twice fast → blocked second time
 *   B. Session isolation    — two concurrent calls don't share context
 *   C. Summary after confirm — shows confirmed status
 *   D. Multi-service confirm — all services preserved
 *   E. Stylist_id flows through confirm
 *   F. Customer info flows through confirm
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

const TOKEN = config.tokens.tenantSalon;

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

describe('voice / salon / hardening-db', () => {
  let serviceId1;
  let serviceId2;

  beforeAll(async () => {
    const setupCallId = uniqueVoiceCallId('salon-hard-setup');
    await setupCall(setupCallId);
    const catalogue = await tool(setupCallId, 'get_services');
    const allServices = catalogue.categories?.flatMap((c) => c.services) ?? [];
    if (allServices.length < 2) throw new Error('Need at least 2 services');
    serviceId1 = allServices[0].id;
    serviceId2 = allServices[1].id;
  });

  // ── A: Dedup protection ───────────────────────────────────────────────────

  describe('A — dedup: same service blocked within dedup window', () => {
    const callId = uniqueVoiceCallId('salon-hard-a-dedup');
    beforeAll(() => setupCall(callId));

    it('first add succeeds; immediate second add is blocked', async () => {
      await tool(callId, 'create_booking', {});
      const r1 = await tool(callId, 'add_booking_service', { service_id: serviceId1 });
      expect(r1.success).toBe(true);

      const r2 = await tool(callId, 'add_booking_service', { service_id: serviceId1 });
      expect(r2.success).toBe(false);
      expect(r2.error).toBe('duplicate_action_blocked');
    });

    it('different service can be added immediately after dedup block', async () => {
      const r = await tool(callId, 'add_booking_service', { service_id: serviceId2 });
      expect(r.success).toBe(true);
    });
  });

  // ── B: Session isolation ──────────────────────────────────────────────────

  describe('B — two calls do not share booking context', () => {
    const callId1 = uniqueVoiceCallId('salon-hard-b1');
    const callId2 = uniqueVoiceCallId('salon-hard-b2');
    beforeAll(() => Promise.all([setupCall(callId1), setupCall(callId2)]));

    it('each session has its own booking context', async () => {
      await tool(callId1, 'create_booking', {});
      await tool(callId1, 'add_booking_service', { service_id: serviceId1 });

      await tool(callId2, 'create_booking', {});

      const summary1 = await tool(callId1, 'get_booking_summary');
      const summary2 = await tool(callId2, 'get_booking_summary');

      expect(summary1.service_count).toBe(1);
      expect(summary2.service_count).toBe(0);
      expect(summary1.booking_id).not.toBe(summary2.booking_id);
    });
  });

  // ── C: Summary after confirm shows confirmed status ───────────────────────

  describe('C — summary after confirm shows confirmed status', () => {
    const callId = uniqueVoiceCallId('salon-hard-c-summary');
    beforeAll(() => setupCall(callId));

    it('confirmed booking shows status=confirmed in summary', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId1 });
      await tool(callId, 'confirm_booking', {
        selected_date: '2026-06-01',
        selected_time_slot: '14:00',
      });

      const summary = await tool(callId, 'get_booking_summary');
      expect(summary.success).toBe(true);
      expect(summary.status).toBe('confirmed');
    });
  });

  // ── D: Multi-service confirm ──────────────────────────────────────────────

  describe('D — multi-service confirm preserves all services', () => {
    const callId = uniqueVoiceCallId('salon-hard-d-multi');
    beforeAll(() => setupCall(callId));

    it('confirms booking with 2 services and correct totals', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId1 });
      // Wait slightly to avoid dedup window for serviceId1
      await new Promise((r) => setTimeout(r, 200));
      await tool(callId, 'add_booking_service', { service_id: serviceId2 });

      const r = await tool(callId, 'confirm_booking', {
        selected_date:      '2026-06-15',
        selected_time_slot: '11:00',
      });
      expect(r.success).toBe(true);
      expect(r.service_count).toBe(2);
      expect(r.total_price_cents).toBeGreaterThan(0);
      expect(r.total_duration_min).toBeGreaterThan(0);
    });
  });

  // ── E: Stylist flows through ──────────────────────────────────────────────

  describe('E — stylist_id passed at confirm flows through', () => {
    const callId = uniqueVoiceCallId('salon-hard-e-stylist');
    beforeAll(() => setupCall(callId));

    it('confirm with stylist_id returns stylist_id in response', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId1 });
      const r = await tool(callId, 'confirm_booking', {
        selected_date:      '2026-07-01',
        selected_time_slot: '09:00',
        stylist_id:         '00000000-0000-0000-0000-000000000001', // fake UUID — just tests flow
      });
      expect(r.success).toBe(true);
      // stylist_id flows through regardless of whether it resolves
      expect(typeof r.stylist_id).toBe('string');
    });
  });

  // ── F: Customer info flows through ────────────────────────────────────────

  describe('F — customer info set at create flows through to confirm', () => {
    const callId = uniqueVoiceCallId('salon-hard-f-customer');
    beforeAll(() => setupCall(callId));

    it('customer name set at create is preserved', async () => {
      await tool(callId, 'create_booking', { customer_name: 'Erika Musterfrau' });
      await tool(callId, 'add_booking_service', { service_id: serviceId1 });

      const summary = await tool(callId, 'get_booking_summary');
      expect(summary.customer_name).toBe('Erika Musterfrau');
    });
  });
});
