// src/modules/voice/tools/booking/answer-booking-question.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * answer_booking_question
 *
 * Answers a caller's question about the booking process, policies, or context.
 * May delegate to an LLM or a knowledge base — TBD.
 *
 * TODO: Implement knowledge-base or LLM integration.
 */
export async function runAnswerBookingQuestion(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  throw new Error('Not implemented: answer_booking_question');
}

/** Route handler for direct HTTP invocation (testing only). */
export async function answerBookingQuestionTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: answer_booking_question route');
}
