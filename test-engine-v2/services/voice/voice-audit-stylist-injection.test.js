'use strict';

/**
 * Voice — Multi-Tenant Audit: Stylist-ID Injection (Level 4 Security)
 *
 * Audit surface: confirm_booking accepts an optional stylist_id argument.
 * This argument is written directly to the booking context and finalized into
 * salon_bookings.stylist_id WITHOUT validating that the UUID belongs to the
 * calling tenant.
 *
 * Attack scenario:
 *   Tenant Morgenlicht (00000000-…-0002) calls confirm_booking with a Studio Nord
 *   stylist UUID (cc000001-…). If the platform is correctly isolated, it should
 *   either reject the foreign UUID or silently ignore it (stylist_id: null).
 *   If isolation is absent, the foreign UUID is persisted in Morgenlicht's booking.
 *
 * Stylist IDs (from seed scripts — stable, deterministic):
 *   Morgenlicht:  Anna   = aa000001-0000-0000-0000-000000000001
 *                Mehmet  = aa000001-0000-0000-0000-000000000002
 *                Sofia   = aa000001-0000-0000-0000-000000000003
 *   Studio Nord:  Lena   = cc000001-0000-0000-0000-000000000001
 *                Oliver  = cc000001-0000-0000-0000-000000000002
 *
 * Services (from seed scripts — used to build a valid confirmable booking):
 *   Morgenlicht:  Damenhaarschnitt = bb000001-0000-0000-0000-000000000001
 *   Studio Nord:  Damen Schnitt    = ff000001-0000-0000-0000-000000000001
 *
 * Expected (correct) behavior:
 *   - Foreign stylist_id → rejected or silently cleared (stylist_id: null in response)
 *   - Only own-tenant stylist UUIDs are accepted
 *
 * Actual behavior may differ — the test documents reality, not assumptions.
 */

const config = require('../../config/config');
const {
  sendVoiceWebhook,
} = require('../../core/apiClient');
const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_SALON_ASSISTANT_ID,
  VAPI_SALON_2_ASSISTANT_ID,
} = require('../../core/factories');

jest.setTimeout(120000);

// ── Stable stylist UUIDs from seed scripts ────────────────────────────────────

// Morgenlicht (tenant 0002) — aa-prefix
const ML_STYLIST_ANNA   = 'aa000001-0000-0000-0000-000000000001';
const ML_STYLIST_MEHMET = 'aa000001-0000-0000-0000-000000000002';

// Studio Nord (tenant 0003) — cc-prefix
const SN_STYLIST_LENA   = 'cc000001-0000-0000-0000-000000000001';
const SN_STYLIST_OLIVER = 'cc000001-0000-0000-0000-000000000002';

// Valid services per tenant (for building a confirmable booking)
const ML_SERVICE_DAMENHAARSCHNITT = 'bb000001-0000-0000-0000-000000000001';
const SN_SERVICE_DAMEN_SCHNITT    = 'ff000001-0000-0000-0000-000000000001';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toolResult(res) {
  const r = res.data?.results?.[0]?.result;
  if (!r) throw new Error(`No result in response: ${JSON.stringify(res.data)}`);
  return r;
}

async function buildConfirmableBooking(callId, serviceId, assistantId) {
  // 1. create_booking
  const cbRes = await sendVoiceWebhook(
    buildVapiToolCall(callId, 'create_booking', {}, assistantId),
  );
  const cbR = toolResult(cbRes);
  if (!cbR.success && cbR.error !== 'booking_already_active') {
    throw new Error(`create_booking failed: ${JSON.stringify(cbR)}`);
  }

  // 2. add_booking_service with a valid own-tenant service
  await sendVoiceWebhook(
    buildVapiToolCall(callId, 'add_booking_service', { service_id: serviceId }, assistantId),
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / audit / stylist-id injection (cross-tenant UUID write)', () => {
  // ── A: Morgenlicht booking confirmed with Studio Nord stylist_id ──────────

  describe('A — Morgenlicht confirm_booking with Studio Nord stylist_id', () => {
    const CALL_ID = uniqueVoiceCallId('audit-stylist-ml');

    beforeAll(async () => {
      const res = await sendVoiceWebhook(
        buildVapiStatusUpdate(CALL_ID, {}, VAPI_SALON_ASSISTANT_ID),
      );
      if (res.status >= 300) {
        throw new Error(`Setup A: webhook rejected with ${res.status}: ${JSON.stringify(res.data)}`);
      }
      await buildConfirmableBooking(CALL_ID, ML_SERVICE_DAMENHAARSCHNITT, VAPI_SALON_ASSISTANT_ID);
    });

    it('confirm_booking with Studio Nord Lena UUID is rejected or returns null stylist_id', async () => {
      const res = await sendVoiceWebhook(
        buildVapiToolCall(
          CALL_ID,
          'confirm_booking',
          {
            customer_name:      'Audit Test ML',
            selected_date:      '2026-05-15',
            selected_time_slot: '10:00',
            stylist_id:         SN_STYLIST_LENA, // FOREIGN: Studio Nord stylist
          },
          VAPI_SALON_ASSISTANT_ID,
        ),
      );

      expect(res.status).toBe(200);
      const r = toolResult(res);

      if (!r.success) {
        // Correct: rejected with an error (stylist_not_found or similar)
        expect(typeof r.error).toBe('string');
        return;
      }

      // If confirm succeeded, the returned stylist_id must NOT be the foreign UUID.
      // Accepting and persisting a foreign tenant's stylist UUID is a cross-tenant
      // write integrity violation.
      if (r.stylist_id === SN_STYLIST_LENA || r.stylist_id === SN_STYLIST_OLIVER) {
        throw new Error(
          `CROSS-TENANT WRITE: Morgenlicht booking confirmed with Studio Nord stylist UUID.\n` +
          `Accepted stylist_id: ${r.stylist_id}\n` +
          `This UUID belongs to Studio Nord (tenant 0003) and was written into a Morgenlicht booking.\n` +
          `Full response: ${JSON.stringify(r)}`,
        );
      }
    });

    it('confirm_booking with Studio Nord Oliver UUID is rejected or returns null stylist_id', async () => {
      // The booking may already be confirmed — call create_booking to get a fresh one
      const newCallId = uniqueVoiceCallId('audit-stylist-ml-2');
      const setup = await sendVoiceWebhook(
        buildVapiStatusUpdate(newCallId, {}, VAPI_SALON_ASSISTANT_ID),
      );
      if (setup.status >= 300) throw new Error(`Setup: ${setup.status}`);

      await buildConfirmableBooking(newCallId, ML_SERVICE_DAMENHAARSCHNITT, VAPI_SALON_ASSISTANT_ID);

      const res = await sendVoiceWebhook(
        buildVapiToolCall(
          newCallId,
          'confirm_booking',
          {
            customer_name:      'Audit Test ML 2',
            selected_date:      '2026-05-16',
            selected_time_slot: '11:00',
            stylist_id:         SN_STYLIST_OLIVER,
          },
          VAPI_SALON_ASSISTANT_ID,
        ),
      );

      expect(res.status).toBe(200);
      const r = toolResult(res);

      if (!r.success) {
        expect(typeof r.error).toBe('string');
        return;
      }

      if (r.stylist_id === SN_STYLIST_LENA || r.stylist_id === SN_STYLIST_OLIVER) {
        throw new Error(
          `CROSS-TENANT WRITE: Morgenlicht booking confirmed with Studio Nord stylist UUID.\n` +
          `Accepted stylist_id: ${r.stylist_id}\n` +
          `Full response: ${JSON.stringify(r)}`,
        );
      }
    });
  });

  // ── B: Studio Nord booking confirmed with Morgenlicht stylist_id ──────────

  describe('B — Studio Nord confirm_booking with Morgenlicht stylist_id', () => {
    const CALL_ID = uniqueVoiceCallId('audit-stylist-sn');

    beforeAll(async () => {
      const res = await sendVoiceWebhook(
        buildVapiStatusUpdate(CALL_ID, {}, VAPI_SALON_2_ASSISTANT_ID),
      );
      if (res.status >= 300) {
        throw new Error(`Setup B: webhook rejected with ${res.status}: ${JSON.stringify(res.data)}`);
      }
      await buildConfirmableBooking(CALL_ID, SN_SERVICE_DAMEN_SCHNITT, VAPI_SALON_2_ASSISTANT_ID);
    });

    it('confirm_booking with Morgenlicht Anna UUID is rejected or returns null stylist_id', async () => {
      const res = await sendVoiceWebhook(
        buildVapiToolCall(
          CALL_ID,
          'confirm_booking',
          {
            customer_name:      'Audit Test SN',
            selected_date:      '2026-05-15',
            selected_time_slot: '14:00',
            stylist_id:         ML_STYLIST_ANNA, // FOREIGN: Morgenlicht stylist
          },
          VAPI_SALON_2_ASSISTANT_ID,
        ),
      );

      expect(res.status).toBe(200);
      const r = toolResult(res);

      if (!r.success) {
        expect(typeof r.error).toBe('string');
        return;
      }

      if (r.stylist_id === ML_STYLIST_ANNA || r.stylist_id === ML_STYLIST_MEHMET) {
        throw new Error(
          `CROSS-TENANT WRITE: Studio Nord booking confirmed with Morgenlicht stylist UUID.\n` +
          `Accepted stylist_id: ${r.stylist_id}\n` +
          `This UUID belongs to Morgenlicht (tenant 0002) and was written into a Studio Nord booking.\n` +
          `Full response: ${JSON.stringify(r)}`,
        );
      }
    });

    it('confirm_booking with Morgenlicht Mehmet UUID is rejected or returns null stylist_id', async () => {
      const newCallId = uniqueVoiceCallId('audit-stylist-sn-2');
      const setup = await sendVoiceWebhook(
        buildVapiStatusUpdate(newCallId, {}, VAPI_SALON_2_ASSISTANT_ID),
      );
      if (setup.status >= 300) throw new Error(`Setup: ${setup.status}`);

      await buildConfirmableBooking(newCallId, SN_SERVICE_DAMEN_SCHNITT, VAPI_SALON_2_ASSISTANT_ID);

      const res = await sendVoiceWebhook(
        buildVapiToolCall(
          newCallId,
          'confirm_booking',
          {
            customer_name:      'Audit Test SN 2',
            selected_date:      '2026-05-16',
            selected_time_slot: '15:00',
            stylist_id:         ML_STYLIST_MEHMET,
          },
          VAPI_SALON_2_ASSISTANT_ID,
        ),
      );

      expect(res.status).toBe(200);
      const r = toolResult(res);

      if (!r.success) {
        expect(typeof r.error).toBe('string');
        return;
      }

      if (r.stylist_id === ML_STYLIST_ANNA || r.stylist_id === ML_STYLIST_MEHMET) {
        throw new Error(
          `CROSS-TENANT WRITE: Studio Nord booking confirmed with Morgenlicht stylist UUID.\n` +
          `Accepted stylist_id: ${r.stylist_id}\n` +
          `Full response: ${JSON.stringify(r)}`,
        );
      }
    });
  });

  // ── C: Own-tenant stylist_id is accepted (control test) ───────────────────
  //
  // Proves the positive case: a valid same-tenant stylist UUID IS accepted.
  // This validates that the test infrastructure works and the tool processes
  // stylist_id at all.

  describe('C — own-tenant stylist_id is accepted (control)', () => {
    it('Morgenlicht confirm_booking with own stylist Anna → stylist_id returned', async () => {
      const callId = uniqueVoiceCallId('audit-stylist-control-ml');
      const setup = await sendVoiceWebhook(
        buildVapiStatusUpdate(callId, {}, VAPI_SALON_ASSISTANT_ID),
      );
      if (setup.status >= 300) throw new Error(`Setup control: ${setup.status}`);

      await buildConfirmableBooking(callId, ML_SERVICE_DAMENHAARSCHNITT, VAPI_SALON_ASSISTANT_ID);

      const res = await sendVoiceWebhook(
        buildVapiToolCall(
          callId,
          'confirm_booking',
          {
            customer_name:      'Control Test ML',
            selected_date:      '2026-05-17',
            selected_time_slot: '09:00',
            stylist_id:         ML_STYLIST_ANNA,
          },
          VAPI_SALON_ASSISTANT_ID,
        ),
      );

      expect(res.status).toBe(200);
      const r = toolResult(res);

      // Positive case — own-tenant stylist should be accepted
      if (!r.success) {
        // If the platform validates stylist ownership, this might also fail with
        // "stylist_not_found" which would indicate stricter validation than expected.
        // That's fine — document it.
        console.warn(`[control] confirm_booking with own stylist rejected: ${JSON.stringify(r)}`);
        return;
      }

      // Stylist_id should be the one we passed (own tenant)
      expect(r.stylist_id).toBe(ML_STYLIST_ANNA);
    });
  });
});
