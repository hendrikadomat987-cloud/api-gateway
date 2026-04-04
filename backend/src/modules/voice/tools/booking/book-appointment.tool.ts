// src/modules/voice/tools/booking/book-appointment.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * book_appointment
 *
 * Books an appointment for the caller at the requested slot.
 * Forwards to the appointments service via n8n.
 */
export async function runBookAppointment(
  _context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { customer_id, start, duration_minutes } = args;

  if (typeof customer_id !== 'string') {
    throw new Error('book_appointment: args.customer_id must be a string');
  }
  if (typeof start !== 'string') {
    throw new Error('book_appointment: args.start must be a string');
  }
  if (typeof duration_minutes !== 'number') {
    throw new Error('book_appointment: args.duration_minutes must be a number');
  }

  const baseUrl = (process.env['N8N_BASE_URL'] ?? '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('book_appointment: N8N_BASE_URL is not configured');
  }

  const response = await fetch(`${baseUrl}/webhook/book-appointment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ customer_id, start, duration_minutes }),
  });

  if (!response.ok) {
    throw new Error(`book_appointment: n8n webhook returned HTTP ${response.status}`);
  }

  const body = await response.json() as { success: boolean; appointment_id: string; status: string };

  if (!body.success) {
    throw new Error('book_appointment: n8n webhook returned unsuccessful response');
  }

  return { success: true, appointment_id: body.appointment_id, status: body.status };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function bookAppointmentTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: book_appointment route');
}
