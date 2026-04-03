// src/modules/voice/tools/restaurant/answer-menu-question.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * answer_menu_question
 *
 * Answers a caller's question about menu items, allergens, or restaurant info.
 *
 * TODO: Implement knowledge-base or LLM integration.
 */
export async function runAnswerMenuQuestion(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  throw new Error('Not implemented: answer_menu_question');
}

/** Route handler for direct HTTP invocation (testing only). */
export async function answerMenuQuestionTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: answer_menu_question route');
}
