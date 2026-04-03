// src/modules/voice/services/provider-validation.service.ts
import { VapiWebhookPayloadSchema } from '../validators/vapi-webhook.schema.js';
import { VoiceEventInvalidError } from '../../../errors/voice-errors.js';
import type { VapiWebhookPayload } from '../providers/vapi/vapi-types.js';

/**
 * Validates and parses an inbound provider webhook payload.
 * Throws VoiceEventInvalidError on any structural failure.
 *
 * Only VAPI is supported in V1.
 */
export function validateVapiPayload(raw: unknown): VapiWebhookPayload {
  const result = VapiWebhookPayloadSchema.safeParse(raw);
  if (!result.success) {
    throw new VoiceEventInvalidError('Invalid VAPI webhook payload', result.error.issues);
  }
  // TODO: The schema coerces to a loose base shape; tighten per message.type once
  // the discriminated union approach is finalised with real VAPI samples.
  return result.data as VapiWebhookPayload;
}
