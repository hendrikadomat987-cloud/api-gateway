// src/modules/voice/utils/voice-context.ts
import type { VoiceContext } from '../../../types/voice.js';

/**
 * Read-only helpers for inspecting and asserting VoiceContext state.
 * These are pure utilities — no side effects, no I/O.
 */

export function assertCallActive(context: VoiceContext): void {
  const terminal: string[] = ['completed', 'failed', 'cancelled', 'fallback', 'handover'];
  if (terminal.includes(context.call.status)) {
    throw new Error(`Call ${context.call.id} is already in terminal state: ${context.call.status}`);
  }
}

export function assertSessionActive(context: VoiceContext): void {
  if (context.session.status !== 'active') {
    throw new Error(`Session ${context.session.id} is not active (status: ${context.session.status})`);
  }
}

/** Returns the session context value for a given key, or undefined. */
export function getSessionValue<T>(context: VoiceContext, key: string): T | undefined {
  return context.session.context_json[key] as T | undefined;
}
