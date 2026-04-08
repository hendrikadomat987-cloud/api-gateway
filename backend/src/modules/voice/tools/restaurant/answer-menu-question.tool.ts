// src/modules/voice/tools/restaurant/answer-menu-question.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';
import { resolveKnowledge } from './knowledge-resolver.js';

/**
 * answer_menu_question
 *
 * Answers a caller's question about menu items, allergens, or restaurant info.
 *
 * Flow:
 *   1. Run question through the knowledge resolver (deterministic, DB-backed)
 *   2. If handled → return the structured answer directly
 *   3. If not handled → fall back to menu-item stub answer
 *
 * Args:
 *   question {string} — the caller's question
 */
export async function runAnswerMenuQuestion(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const question = typeof args.question === 'string' ? args.question.trim() : '';

  if (question.length > 0) {
    const knowledge = await resolveKnowledge(context.tenantId, question);

    if (knowledge.handled) {
      return {
        success:  true,
        question,
        answer:   knowledge.answer,
        intent:   knowledge.intent,
        source:   'knowledge',
        metadata: knowledge.metadata,
      };
    }
  }

  // Fallback: generic menu answer (replaces former LLM stub)
  return {
    success:  true,
    question,
    answer:   'Wir haben unter anderem Margherita und Salami Pizza auf der Karte. Gerne beantworte ich Ihre spezifische Frage.',
    intent:   'menu_question',
    source:   'fallback',
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function answerMenuQuestionTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: answer_menu_question route');
}
