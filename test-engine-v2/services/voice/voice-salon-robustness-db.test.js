'use strict';

/**
 * Voice — Salon Robustness DB
 *
 * Tests that the salon booking system handles errors, missing context,
 * invalid inputs, and illegal state transitions explicitly.
 *
 *   A. Mutation without active booking     → no_active_booking
 *   B. Confirm without services            → empty_booking
 *   C. Confirm without date                → missing_required_context
 *   D. Confirm without time slot           → missing_required_context
 *   E. Add unknown service_id UUID         → service_not_found
 *   F. Remove from empty booking           → empty_booking
 *   G. Update after confirm                → already_confirmed
 *   H. Duplicate confirm                   → already_confirmed
 *   I. create_booking idempotent           → reused
 *   J. Missing service_id in add_booking_service → missing_service_reference
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

describe('voice / salon / robustness-db', () => {
  let serviceId;

  beforeAll(async () => {
    const setupCallId = uniqueVoiceCallId('salon-robust-setup');
    await setupCall(setupCallId);
    const catalogue = await tool(setupCallId, 'get_services');
    const allServices = catalogue.categories?.flatMap((c) => c.services) ?? [];
    if (allServices.length === 0) throw new Error('No services found');
    serviceId = allServices[0].id;
  });

  // ── A: Mutation without booking ───────────────────────────────────────────

  describe('A — mutations without an active booking', () => {
    const callId = uniqueVoiceCallId('salon-robust-a');
    beforeAll(() => setupCall(callId));

    it('add_booking_service without booking auto-creates one', async () => {
      // add_booking_service auto-creates like add_order_item in restaurant
      const r = await tool(callId, 'add_booking_service', { service_id: serviceId });
      // auto-create path — should succeed
      expect(r.success).toBe(true);
    });

    it('remove_booking_service without booking returns no_active_booking', async () => {
      const freshCallId = uniqueVoiceCallId('salon-robust-a-remove');
      await setupCall(freshCallId);
      const r = await tool(freshCallId, 'remove_booking_service', { service_id: '1' });
      expect(r.success).toBe(false);
      expect(r.error).toBe('no_active_booking');
    });

    it('confirm_booking without booking returns no_active_booking', async () => {
      const freshCallId = uniqueVoiceCallId('salon-robust-a-confirm');
      await setupCall(freshCallId);
      const r = await tool(freshCallId, 'confirm_booking', {
        selected_date: '2026-05-01', selected_time_slot: '10:00',
      });
      expect(r.success).toBe(false);
      expect(r.error).toBe('no_active_booking');
    });
  });

  // ── B: Confirm empty booking ──────────────────────────────────────────────

  describe('B — confirm without services returns empty_booking', () => {
    const callId = uniqueVoiceCallId('salon-robust-b');
    beforeAll(() => setupCall(callId));

    it('returns empty_booking error', async () => {
      await tool(callId, 'create_booking', {});
      const r = await tool(callId, 'confirm_booking', {
        selected_date: '2026-05-01', selected_time_slot: '10:00',
      });
      expect(r.success).toBe(false);
      expect(r.error).toBe('empty_booking');
    });
  });

  // ── C: Confirm without date ───────────────────────────────────────────────

  describe('C — confirm without date returns missing_required_context', () => {
    const callId = uniqueVoiceCallId('salon-robust-c');
    beforeAll(() => setupCall(callId));

    it('returns missing_required_context', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId });
      const r = await tool(callId, 'confirm_booking', { selected_time_slot: '10:00' });
      expect(r.success).toBe(false);
      expect(r.error).toBe('missing_required_context');
    });
  });

  // ── D: Confirm without time slot ──────────────────────────────────────────

  describe('D — confirm without time slot returns missing_required_context', () => {
    const callId = uniqueVoiceCallId('salon-robust-d');
    beforeAll(() => setupCall(callId));

    it('returns missing_required_context', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId });
      const r = await tool(callId, 'confirm_booking', { selected_date: '2026-05-01' });
      expect(r.success).toBe(false);
      expect(r.error).toBe('missing_required_context');
    });
  });

  // ── E: Unknown service UUID ───────────────────────────────────────────────

  describe('E — add_booking_service with unknown UUID', () => {
    const callId = uniqueVoiceCallId('salon-robust-e');
    beforeAll(() => setupCall(callId));

    it('returns service_not_found', async () => {
      await tool(callId, 'create_booking', {});
      const r = await tool(callId, 'add_booking_service', {
        service_id: '00000000-0000-0000-0000-000000000999',
      });
      expect(r.success).toBe(false);
      expect(r.error).toBe('service_not_found');
    });
  });

  // ── F: Remove from empty booking ─────────────────────────────────────────

  describe('F — remove from empty booking', () => {
    const callId = uniqueVoiceCallId('salon-robust-f');
    beforeAll(() => setupCall(callId));

    it('returns empty_booking', async () => {
      await tool(callId, 'create_booking', {});
      const r = await tool(callId, 'remove_booking_service', { service_id: 'erste' });
      expect(r.success).toBe(false);
      expect(r.error).toBe('empty_booking');
    });
  });

  // ── G: Mutation after confirm ─────────────────────────────────────────────

  describe('G — mutation after confirm is blocked', () => {
    const callId = uniqueVoiceCallId('salon-robust-g');
    beforeAll(() => setupCall(callId));

    it('add_booking_service after confirm returns already_confirmed', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId });
      await tool(callId, 'confirm_booking', {
        selected_date: '2026-05-01',
        selected_time_slot: '10:00',
      });

      const r = await tool(callId, 'add_booking_service', { service_id: serviceId });
      expect(r.success).toBe(false);
      expect(r.error).toBe('already_confirmed');
    });
  });

  // ── H: Duplicate confirm ──────────────────────────────────────────────────

  describe('H — duplicate confirm returns already_confirmed', () => {
    const callId = uniqueVoiceCallId('salon-robust-h');
    beforeAll(() => setupCall(callId));

    it('second confirm returns already_confirmed', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId });
      await tool(callId, 'confirm_booking', {
        selected_date: '2026-05-01',
        selected_time_slot: '10:00',
      });

      const r2 = await tool(callId, 'confirm_booking', {
        selected_date: '2026-05-01',
        selected_time_slot: '10:00',
      });
      expect(r2.success).toBe(false);
      expect(r2.error).toBe('already_confirmed');
    });
  });

  // ── I: Idempotent create ──────────────────────────────────────────────────

  describe('I — create_booking is idempotent', () => {
    const callId = uniqueVoiceCallId('salon-robust-i');
    beforeAll(() => setupCall(callId));

    it('second create returns reused with same booking_id', async () => {
      const r1 = await tool(callId, 'create_booking', {});
      const r2 = await tool(callId, 'create_booking', {});
      expect(r1.status).toBe('created');
      expect(r2.status).toBe('reused');
      expect(r2.booking_id).toBe(r1.booking_id);
    });
  });

  // ── J: Missing service_id ─────────────────────────────────────────────────

  describe('J — add_booking_service missing service_id', () => {
    const callId = uniqueVoiceCallId('salon-robust-j');
    beforeAll(() => setupCall(callId));

    it('returns missing_service_reference', async () => {
      await tool(callId, 'create_booking', {});
      const r = await tool(callId, 'add_booking_service', { service_id: '' });
      expect(r.success).toBe(false);
      expect(r.error).toBe('missing_service_reference');
    });
  });

  // ── K: create_booking after confirm ───────────────────────────────────────

  describe('K — create_booking after confirm returns already_confirmed', () => {
    const callId = uniqueVoiceCallId('salon-robust-k');
    beforeAll(() => setupCall(callId));

    it('create_booking after confirm returns already_confirmed (does not overwrite context)', async () => {
      await tool(callId, 'create_booking', {});
      await tool(callId, 'add_booking_service', { service_id: serviceId });
      await tool(callId, 'confirm_booking', {
        selected_date: '2026-05-20',
        selected_time_slot: '11:00',
      });

      const r = await tool(callId, 'create_booking', {});
      expect(r.success).toBe(false);
      expect(r.error).toBe('already_confirmed');
    });
  });
});
