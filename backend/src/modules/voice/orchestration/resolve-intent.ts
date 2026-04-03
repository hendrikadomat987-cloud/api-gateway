// src/modules/voice/orchestration/resolve-intent.ts
import type { VoiceContext } from '../../../types/voice.js';

/**
 * Resolves high-level user intent from the current session context.
 *
 * Intent resolution is track-aware. In V1, intent is derived from
 * the active tool call name rather than NLU classification.
 *
 * TODO: Implement intent classification if needed beyond tool dispatch.
 */
export function resolveIntent(
  _context: VoiceContext,
  toolName: string,
): string {
  // TODO: Map tool names to semantic intents for logging / analytics.
  return toolName;
}
