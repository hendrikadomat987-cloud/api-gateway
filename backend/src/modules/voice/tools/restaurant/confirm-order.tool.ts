// src/modules/voice/tools/restaurant/confirm-order.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * confirm_order
 *
 * Finalises and submits the caller's order downstream (via n8n — TBD).
 *
 * TODO: Implement order submission and n8n handoff.
 */
export async function runConfirmOrder(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  throw new Error('Not implemented: confirm_order');
}

/** Route handler for direct HTTP invocation (testing only). */
export async function confirmOrderTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: confirm_order route');
}
