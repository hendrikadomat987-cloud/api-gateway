// src/modules/voice/tools/booking/check-availability.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * check_availability
 *
 * Checks whether a specific slot is bookable for a customer.
 * Forwards to the availability engine via n8n (/webhook/availability-engine/check).
 */
export async function runCheckAvailability(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { start, customer_id, duration_minutes, timezone = 'Europe/Berlin' } = args;

  if (typeof start !== 'string') {
    throw new Error('check_availability: args.start must be a string');
  }
  if (typeof customer_id !== 'string') {
    throw new Error('check_availability: args.customer_id must be a string');
  }
  if (typeof duration_minutes !== 'number') {
    throw new Error('check_availability: args.duration_minutes must be a number');
  }

  const baseUrl = (process.env['N8N_BASE_URL'] ?? '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('check_availability: N8N_BASE_URL is not configured');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/webhook/availability-engine/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': context.tenantId,
      },
      body: JSON.stringify({ start, customer_id, duration_minutes, timezone }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error('check_availability: n8n webhook timed out after 8 s');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`check_availability: n8n webhook returned HTTP ${response.status}`);
  }

  const body = await response.json() as {
    success: boolean;
    data?: { bookable: boolean; reason: string | null };
    error?: { code: string; message: string };
  };

  if (!body.success) {
    // AE returned a structured error (e.g. DB_ERROR, VALIDATION_ERROR) — surface to voice gracefully
    return {
      success: false,
      bookable: false,
      reason: 'unavailable',
      error: body.error?.code ?? 'AE_ERROR',
    };
  }

  return { success: true, bookable: body.data!.bookable, reason: body.data!.reason };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function checkAvailabilityTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: check_availability route');
}
