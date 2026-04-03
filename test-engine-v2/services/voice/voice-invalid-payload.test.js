'use strict';

/**
 * Voice — Invalid Payload Test
 *
 * Verifies that the public webhook endpoint rejects malformed requests cleanly.
 *
 * VAPI call schema required fields (validated by Zod before anything else):
 *   message.type          — required string
 *   message.call          — required object
 *   message.call.id       — required string
 *   message.call.createdAt — required string
 *   message.call.updatedAt — required string
 *
 * Tests:
 *   - missing message.type    → 400 VOICE_EVENT_INVALID (Zod schema failure)
 *   - missing call.id         → 400 VOICE_EVENT_INVALID (Zod schema failure)
 *   - missing call.createdAt  → 400 VOICE_EVENT_INVALID (Zod schema failure)
 *   - missing message wrapper → 400 VOICE_EVENT_INVALID (Zod schema failure)
 *   - garbage payload         → 400 (no 5xx)
 *   - unknown event type with otherwise-valid call → 400 or 200 (no 5xx, no crash)
 *   - valid recovery request  → 2xx (no DB corruption from prior invalid payloads)
 */

const {
  sendVoiceWebhook,
} = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  uniqueVoiceCallId,
} = require('../../core/factories');

// ── Shared test-only call template (all required fields present) ─────────────

const NOW = new Date().toISOString();

function validCall(id = 'bad-call-001') {
  return { id, createdAt: NOW, updatedAt: NOW };
}

// ─────────────────────────────────────────────────────────────────────────────

// Unique call ID per run for the "no corruption" recovery test
const RECOVERY_CALL_ID = uniqueVoiceCallId('test-call-recovery');

describe('voice / invalid-payload', () => {

  // ── Missing message.type ───────────────────────────────────────────────────

  it('missing message.type → 400 (VOICE_EVENT_INVALID)', async () => {
    const payload = {
      message: {
        // type intentionally omitted
        call:      validCall('bad-call-001'),
        timestamp: NOW,
      },
    };

    const res = await sendVoiceWebhook(payload);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    if (res.data) expect(res.data.success).toBe(false);
  });

  // ── Missing call.id ────────────────────────────────────────────────────────

  it('missing message.call.id → 400 (VOICE_EVENT_INVALID)', async () => {
    const payload = {
      message: {
        type: 'status-update',
        call: {
          // id intentionally omitted
          createdAt: NOW,
          updatedAt: NOW,
        },
        timestamp: NOW,
      },
    };

    const res = await sendVoiceWebhook(payload);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    if (res.data) expect(res.data.success).toBe(false);
  });

  // ── Missing call.createdAt (required schema field) ────────────────────────

  it('missing message.call.createdAt → 400 (VOICE_EVENT_INVALID)', async () => {
    const payload = {
      message: {
        type: 'status-update',
        call: {
          id:        'bad-call-002',
          updatedAt: NOW,
          // createdAt intentionally omitted
        },
        timestamp: NOW,
      },
    };

    const res = await sendVoiceWebhook(payload);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    if (res.data) expect(res.data.success).toBe(false);
  });

  // ── Missing message wrapper ────────────────────────────────────────────────

  it('missing message wrapper (flat payload) → 400 (VOICE_EVENT_INVALID)', async () => {
    // Backend expects { message: { ... } } at the top level
    const payload = {
      type: 'status-update',
      call: validCall('bad-call-003'),
    };

    const res = await sendVoiceWebhook(payload);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // ── Completely invalid payload ─────────────────────────────────────────────

  it('garbage payload → no 5xx (backend validates before persisting)', async () => {
    const res = await sendVoiceWebhook({ foo: 'bar', random: 42 });

    expect(res.status).not.toBeGreaterThanOrEqual(500);
  });

  it('empty object → 400 (VOICE_EVENT_INVALID)', async () => {
    const res = await sendVoiceWebhook({});

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // ── Unknown event type (schema-valid call, unrecognised type) ─────────────
  //
  // The VAPI schema uses z.string() for type, so unknown types pass schema validation.
  // The orchestration service handles unknowns with a default return (no crash).
  // However, tenant resolution may still fail (400) if VAPI_ASSISTANT_ID is not
  // configured. Either 200 or 400 is acceptable here — 5xx is not.

  it('unknown event type with valid call → no 5xx', async () => {
    const payload = {
      message: {
        type:      'non-existent-event-type-xyz',
        call:      validCall('bad-call-004'),
        timestamp: NOW,
      },
    };

    const res = await sendVoiceWebhook(payload);

    expect(res.status).not.toBeGreaterThanOrEqual(500);
  });

  // ── No DB corruption after invalid payloads ────────────────────────────────

  it('valid request after invalid payloads succeeds (no DB corruption)', async () => {
    const payload = buildVapiStatusUpdate(RECOVERY_CALL_ID);
    const res     = await sendVoiceWebhook(payload);

    expect(res.status).toBeLessThan(300);

    if (res.data && res.data.success === false) {
      throw new Error(
        `Valid webhook rejected after invalid ones — possible DB corruption.\n` +
        `provider_call_id: ${RECOVERY_CALL_ID}\n` +
        `Response: ${JSON.stringify(res.data)}`
      );
    }
  });
});
