// src/modules/voice/providers/vapi/vapi-signature.ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { InvalidProviderSignatureError } from '../../../../errors/voice-errors.js';

/**
 * Verifies the VAPI webhook signature.
 *
 * VAPI signs the raw request body using HMAC-SHA256 with the webhook secret.
 * The signature is provided in the `x-vapi-signature` header.
 */
export function verifyVapiSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): void {
  // TEMP: set DISABLE_VAPI_SIGNATURE=true in .env to bypass during testing.
  // Remove this guard to enforce signature validation in production.
  if (process.env.DISABLE_VAPI_SIGNATURE === 'true') return;

  if (!signature) {
    throw new InvalidProviderSignatureError('Missing VAPI signature header');
  }

  if (rawBody.length === 0) {
    throw new InvalidProviderSignatureError('Empty request body');
  }

  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const trimmed = signature.trim();

  const expectedBuf = Buffer.from(expected, 'hex');
  const signatureBuf = Buffer.from(trimmed, 'hex');

  if (expectedBuf.length !== signatureBuf.length) {
    throw new InvalidProviderSignatureError('VAPI signature mismatch');
  }

  if (!timingSafeEqual(expectedBuf, signatureBuf)) {
    throw new InvalidProviderSignatureError('VAPI signature mismatch');
  }
}
