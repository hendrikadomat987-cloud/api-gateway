// src/modules/voice/tools/booking/check-availability.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * check_availability
 *
 * Checks whether a specific slot is bookable for a customer.
 * Forwards to the availability engine via n8n.
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

  const response = await fetch(`${baseUrl}/webhook/check-availability`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ start, customer_id, duration_minutes }),
  });

  if (!response.ok) {
    throw new Error(`check_availability: n8n webhook returned HTTP ${response.status}`);
  }

  const body = await response.json() as { success: boolean; slots: string[] };

  if (!body.success) {
    throw new Error('check_availability: n8n webhook returned unsuccessful response');
  }

  const slots = Array.isArray(body.slots) ? body.slots : [];
  return { success: true, bookable: slots.length > 0, slots };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function checkAvailabilityTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: check_availability route');
}
