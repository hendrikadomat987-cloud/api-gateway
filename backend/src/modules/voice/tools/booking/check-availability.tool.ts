// src/modules/voice/tools/booking/check-availability.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * check_availability
 *
 * Returns available time slots for a given date range.
 * Delegates to the availability-engine (via n8n or direct call — TBD).
 *
 * TODO: Implement availability-engine integration.
 */
export async function runCheckAvailability(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  throw new Error('Not implemented: check_availability');
}

/** Route handler for direct HTTP invocation (testing only). */
export async function checkAvailabilityTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: check_availability route');
}
