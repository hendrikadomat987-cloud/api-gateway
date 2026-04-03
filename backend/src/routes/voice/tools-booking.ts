// src/routes/voice/tools-booking.ts
import type { FastifyInstance } from 'fastify';
import { checkAvailabilityTool } from '../../modules/voice/tools/booking/check-availability.tool.js';
import { getNextFreeTool } from '../../modules/voice/tools/booking/get-next-free.tool.js';
import { bookAppointmentTool } from '../../modules/voice/tools/booking/book-appointment.tool.js';
import { answerBookingQuestionTool } from '../../modules/voice/tools/booking/answer-booking-question.tool.js';
import { createCallbackRequestTool } from '../../modules/voice/tools/booking/create-callback-request.tool.js';

/**
 * Booking tool routes (C.4.1).
 * In production, tools are dispatched programmatically via resolve-tool.ts, not via HTTP.
 * These routes exist for integration testing and direct tool invocation during development.
 */
export async function voiceToolsBookingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/voice/tools/booking/check-availability', checkAvailabilityTool);
  app.post('/api/v1/voice/tools/booking/get-next-free', getNextFreeTool);
  app.post('/api/v1/voice/tools/booking/book-appointment', bookAppointmentTool);
  app.post('/api/v1/voice/tools/booking/answer-question', answerBookingQuestionTool);
  app.post('/api/v1/voice/tools/booking/create-callback-request', createCallbackRequestTool);
}
