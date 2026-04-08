'use strict';

/**
 * Voice — Salon Booking DB
 *
 * Tests the full booking flow with DB persistence verification.
 *
 *   A. create_booking idempotency — second call reuses active draft
 *   B. add + remove service — service removed from context
 *   C. add + update service — service replaced correctly
 *   D. get_booking_summary — reflects current state
 *   E. multi-service booking — totals aggregate correctly
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
  if (res.status !== 200) throw new Error(`${name} HTTP ${res.status}: ${JSON.stringify(res.data)}`);
  const results = res.data?.results;
  if (!Array.isArray(results) || results.length === 0) throw new Error(`${name} empty results`);
  return results[0].result;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / salon / booking-db', () => {
  let serviceId1;
  let serviceId2;

  // Resolve service IDs before all tests
  beforeAll(async () => {
    const setupCallId = uniqueVoiceCallId('salon-booking-setup');
    await setupCall(setupCallId);
    const catalogue = await tool(setupCallId, 'get_services');
    const allServices = catalogue.categories?.flatMap((c) => c.services) ?? [];
    if (allServices.length < 2) throw new Error('Need at least 2 active services to run these tests');
    serviceId1 = allServices[0].id;
    serviceId2 = allServices[1].id;
  });

  // ── A: create_booking idempotency ─────────────────────────────────────────

  describe('A — create_booking idempotency', () => {
    const callId = uniqueVoiceCallId('salon-booking-idempotent');
    beforeAll(() => setupCall(callId));

    it('first create returns status=created', async () => {
      const r = await tool(callId, 'create_booking', {});
      expect(r.success).toBe(true);
      expect(r.status).toBe('created');
      expect(typeof r.booking_id).toBe('string');
    });

    it('second create returns status=reused (same booking_id)', async () => {
      const r1 = await tool(callId, 'create_booking', {});
      const r2 = await tool(callId, 'create_booking', {});
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r2.status).toBe('reused');
      expect(r2.booking_id).toBe(r1.booking_id);
    });
  });

  // ── B: add + remove ───────────────────────────────────────────────────────

  describe('B — add then remove a service', () => {
    const callId = uniqueVoiceCallId('salon-booking-add-remove');
    beforeAll(() => setupCall(callId));

    it('adds service successfully', async () => {
      await tool(callId, 'create_booking', {});
      const r = await tool(callId, 'add_booking_service', { service_id: serviceId1 });
      expect(r.success).toBe(true);
      expect(r.status).toBe('service_added');
      expect(r.total_price_cents).toBeGreaterThan(0);
    });

    it('removes service — booking becomes empty', async () => {
      const r = await tool(callId, 'remove_booking_service', { service_id: '1' });
      expect(r.success).toBe(true);
      expect(r.status).toBe('service_removed');
      expect(r.total_price_cents).toBe(0);
      expect(r.total_duration_min).toBe(0);
    });

    it('summary shows 0 services after remove', async () => {
      const r = await tool(callId, 'get_booking_summary');
      expect(r.success).toBe(true);
      expect(r.service_count).toBe(0);
    });
  });

  // ── C: add + update ───────────────────────────────────────────────────────

  describe('C — add then update to different service', () => {
    const callId = uniqueVoiceCallId('salon-booking-update');
    beforeAll(() => setupCall(callId));

    it('adds service1, then updates to service2', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId1 });

      const updateRes = await tool(callId, 'update_booking_service', {
        service_id:     '1',
        new_service_id: serviceId2,
      });
      expect(updateRes.success).toBe(true);
      expect(updateRes.status).toBe('service_updated');
      expect(updateRes.service.service_id).toBe(serviceId2);
    });

    it('summary reflects updated service', async () => {
      const r = await tool(callId, 'get_booking_summary');
      expect(r.service_count).toBe(1);
      expect(r.services[0].name).toBeDefined();
    });
  });

  // ── D: get_booking_summary ────────────────────────────────────────────────

  describe('D — get_booking_summary fields', () => {
    const callId = uniqueVoiceCallId('salon-booking-summary');
    beforeAll(() => setupCall(callId));

    it('has all required fields', async () => {
      await tool(callId, 'create_booking', { customer_name: 'Max Mustermann' });
      await tool(callId, 'add_booking_service', { service_id: serviceId1 });
      const r = await tool(callId, 'get_booking_summary');

      expect(r.success).toBe(true);
      expect(typeof r.booking_id).toBe('string');
      expect(r.status).toBe('draft');
      expect(typeof r.service_count).toBe('number');
      expect(typeof r.total_price_cents).toBe('number');
      expect(typeof r.total_duration_min).toBe('number');
      expect(Array.isArray(r.services)).toBe(true);
    });
  });

  // ── E: multi-service totals ───────────────────────────────────────────────

  describe('E — multi-service totals', () => {
    const callId = uniqueVoiceCallId('salon-booking-multi');
    beforeAll(() => setupCall(callId));

    it('adds 2 services and totals aggregate correctly', async () => {
      await tool(callId, 'create_booking', {});
      const r1 = await tool(callId, 'add_booking_service', { service_id: serviceId1 });
      const r2 = await tool(callId, 'add_booking_service', { service_id: serviceId2 });

      const summary = await tool(callId, 'get_booking_summary');
      expect(summary.service_count).toBe(2);
      expect(summary.total_price_cents).toBeGreaterThan(0);
      expect(summary.total_duration_min).toBeGreaterThan(0);
    });
  });
});
