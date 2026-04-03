// src/modules/voice/tools/booking/book-appointment.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * book_appointment
 *
 * Books an appointment for the caller at the requested slot.
 * Dispatches the booking request downstream (n8n or direct service — TBD).
 *
 * TODO: Implement booking service integration.
 */
export async function runBookAppointment(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  throw new Error('Not implemented: book_appointment');
}

/** Route handler for direct HTTP invocation (testing only). */
export async function bookAppointmentTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: book_appointment route');
}
