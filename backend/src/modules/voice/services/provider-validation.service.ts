// src/modules/voice/services/provider-validation.service.ts
import { VapiWebhookPayloadSchema } from '../validators/vapi-webhook.schema.js';
import { VoiceEventInvalidError } from '../../../errors/voice-errors.js';
import { serviceLogger } from '../../../logger/index.js';
import type { VapiWebhookPayload } from '../providers/vapi/vapi-types.js';

const log = serviceLogger.child({ name: 'voice.validation' });

/**
 * Validates and parses an inbound provider webhook payload.
 * Throws VoiceEventInvalidError on any structural failure.
 *
 * Only VAPI is supported in V1.
 */
export function validateVapiPayload(raw: unknown): VapiWebhookPayload {
  const result = VapiWebhookPayloadSchema.safeParse(raw);
  if (!result.success) {
    // Peek at message type for correlation — may be absent if the envelope itself is malformed
    const typeHint =
      raw != null && typeof raw === 'object' && 'message' in raw
        ? (raw as Record<string, unknown>).message != null &&
          typeof (raw as Record<string, unknown>).message === 'object' &&
          'type' in ((raw as Record<string, unknown>).message as object)
          ? ((raw as Record<string, unknown>).message as Record<string, unknown>).type
          : '(unknown)'
        : '(missing envelope)';

    log.warn(
      {
        messageType: typeHint,
        issueCount: result.error.issues.length,
        // Surface only the first issue to avoid log bloat; enough to diagnose schema drift
        firstIssue: result.error.issues[0]
          ? {
              path: result.error.issues[0].path.join('.'),
              code: result.error.issues[0].code,
              message: result.error.issues[0].message,
            }
          : undefined,
      },
      '[voice:validation:failed]',
    );
    throw new VoiceEventInvalidError('Invalid VAPI webhook payload', result.error.issues);
  }
  // TODO: The schema coerces to a loose base shape; tighten per message.type once
  // the discriminated union approach is finalised with real VAPI samples.
  return result.data as VapiWebhookPayload;
}
