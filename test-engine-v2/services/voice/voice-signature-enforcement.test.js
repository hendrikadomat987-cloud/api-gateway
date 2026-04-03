'use strict';

/**
 * Voice — Signature Enforcement Tests
 *
 * Verifies that the VAPI webhook endpoint enforces HMAC-SHA256 signature
 * verification on every inbound request, staging-parity: no grace mode.
 *
 * Cases:
 *   1. Valid signature   → webhook accepted (2xx)
 *   2. Missing signature → 401 INVALID_PROVIDER_SIGNATURE
 *   3. Wrong signature   → 401 INVALID_PROVIDER_SIGNATURE
 *
 * Uses sendVoiceWebhookSigned() to control the x-vapi-signature header
 * independently from the request body.
 */

const { createHmac } = require('node:crypto');

const {
  sendVoiceWebhook,
  sendVoiceWebhookSigned,
} = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  uniqueVoiceCallId,
} = require('../../core/factories');

const { expectError } = require('../../core/assertions');

// ─────────────────────────────────────────────────────────────────────────────

const SECRET = process.env.VAPI_WEBHOOK_SECRET || '';

/**
 * Compute a valid HMAC-SHA256 signature for the given JSON body string.
 * Mirrors the logic in apiClient.sendVoiceWebhook().
 *
 * @param {string} bodyStr
 * @returns {string} hex digest
 */
function computeValidSig(bodyStr) {
  return createHmac('sha256', SECRET).update(bodyStr).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / signature-enforcement', () => {
  const CALL_ID = uniqueVoiceCallId('test-sig-enf');

  // ── Case 1: Valid signature ────────────────────────────────────────────────

  it('valid HMAC-SHA256 signature → webhook accepted (2xx)', async () => {
    const payload = buildVapiStatusUpdate(CALL_ID);
    const res     = await sendVoiceWebhook(payload);   // sends correct sig automatically

    expect(res.status).toBeLessThan(300);

    if (res.data && res.data.success === false) {
      throw new Error(
        `Webhook with valid signature was rejected.\n` +
        `Status: ${res.status}\n` +
        `Body: ${JSON.stringify(res.data)}`
      );
    }
  });

  // ── Case 2: Missing signature ──────────────────────────────────────────────

  it('missing x-vapi-signature header → 401 INVALID_PROVIDER_SIGNATURE', async () => {
    const payload = buildVapiStatusUpdate(uniqueVoiceCallId('test-sig-missing'));
    const res     = await sendVoiceWebhookSigned(payload, null);   // omit header

    expectError(res, 401, 'INVALID_PROVIDER_SIGNATURE');
  });

  // ── Case 3: Wrong signature ────────────────────────────────────────────────

  it('tampered x-vapi-signature → 401 INVALID_PROVIDER_SIGNATURE', async () => {
    const payload = buildVapiStatusUpdate(uniqueVoiceCallId('test-sig-wrong'));
    const bodyStr = JSON.stringify(payload);

    // Compute the valid sig, then flip the last two hex chars to ensure mismatch
    const validSig = computeValidSig(bodyStr);
    const wrongSig = validSig.slice(0, -2) + (validSig.endsWith('aa') ? 'bb' : 'aa');

    const res = await sendVoiceWebhookSigned(payload, wrongSig);

    expectError(res, 401, 'INVALID_PROVIDER_SIGNATURE');
  });

  // ── Case 4: Signature for different body ──────────────────────────────────

  it('valid sig for a different body → 401 INVALID_PROVIDER_SIGNATURE', async () => {
    const payload    = buildVapiStatusUpdate(uniqueVoiceCallId('test-sig-mismatch'));
    const otherBody  = JSON.stringify(buildVapiStatusUpdate('some-other-call-id'));
    const wrongSig   = computeValidSig(otherBody);   // sig for different payload

    const res = await sendVoiceWebhookSigned(payload, wrongSig);

    expectError(res, 401, 'INVALID_PROVIDER_SIGNATURE');
  });
});
