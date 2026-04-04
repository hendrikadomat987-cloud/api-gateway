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
  return {
    success:  true,
    question: typeof _args?.question === 'string' ? _args.question : 'Welche Pizza habt ihr?',
    answer:   'Wir haben unter anderem Margherita und Salami Pizza auf der Karte.',
    source:   'stub',
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function answerMenuQuestionTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: answer_menu_question route');
}
