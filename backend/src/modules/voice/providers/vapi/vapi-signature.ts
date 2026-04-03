// src/modules/voice/providers/vapi/vapi-signature.ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { InvalidProviderSignatureError } from '../../../../errors/voice-errors.js';

/**
 * Verifies the VAPI webhook signature.
 *
 * VAPI signs the raw request body using HMAC-SHA256 with the webhook secret.
 * The signature is provided in the `x-vapi-signature` header.
 *
 * TODO: Confirm exact header name and signing algorithm with VAPI documentation.
 */
export function verifyVapiSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): void {
  if (!signature) {
    throw new InvalidProviderSignatureError('Missing VAPI signature header');
  }

  // TODO: Verify actual VAPI signature scheme (header name, hash algo, encoding).
  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const signatureBuf = Buffer.from(signature, 'utf8');

  if (expectedBuf.length !== signatureBuf.length) {
    throw new InvalidProviderSignatureError('VAPI signature mismatch');
  }

  if (!timingSafeEqual(expectedBuf, signatureBuf)) {
    throw new InvalidProviderSignatureError('VAPI signature mismatch');
  }
}
