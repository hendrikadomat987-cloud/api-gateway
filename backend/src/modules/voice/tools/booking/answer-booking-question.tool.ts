// src/modules/voice/tools/booking/answer-booking-question.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * answer_booking_question
 *
 * Answers a caller's question about the booking process, policies, or context.
 * Forwards to the knowledge service via n8n.
 */
export async function runAnswerBookingQuestion(
  _context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { question } = args;

  if (typeof question !== 'string') {
    throw new Error('answer_booking_question: args.question must be a string');
  }

  const baseUrl = (process.env['N8N_BASE_URL'] ?? '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('answer_booking_question: N8N_BASE_URL is not configured');
  }

  const response = await fetch(`${baseUrl}/webhook/answer-booking-question`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question }),
  });

  if (!response.ok) {
    throw new Error(`answer_booking_question: n8n webhook returned HTTP ${response.status}`);
  }

  const body = await response.json() as { success: boolean; answer: string };

  if (!body.success) {
    throw new Error('answer_booking_question: n8n webhook returned unsuccessful response');
  }

  return { success: true, answer: body.answer };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function answerBookingQuestionTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: answer_booking_question route');
}
