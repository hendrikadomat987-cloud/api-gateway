// src/modules/voice/tools/salon/answer-booking-question.tool.ts
//
// answer_booking_question — answers FAQ questions about the salon.
// Uses the deterministic knowledge resolver before falling back.
// Analogous to restaurant/answer-menu-question.tool.ts.

import type { VoiceContext } from '../../../../types/voice.js';
import { resolveSalonKnowledge } from './salon-knowledge-resolver.js';

export async function runAnswerBookingQuestion(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const question = typeof args.question === 'string' ? args.question.trim() : '';

  if (question.length > 0) {
    const knowledge = await resolveSalonKnowledge(context.tenantId, question);

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

  // Fallback: generic salon answer
  return {
    success:  true,
    question,
    answer:   'Ich beantworte gerne Ihre Fragen zum Salon. Bitte fragen Sie direkt nach Öffnungszeiten, Preisen oder Leistungen.',
    intent:   'salon_question',
    source:   'fallback',
  };
}
