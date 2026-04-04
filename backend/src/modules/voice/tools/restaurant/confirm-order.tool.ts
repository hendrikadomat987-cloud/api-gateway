// src/modules/voice/tools/restaurant/confirm-order.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * confirm_order
 *
 * Finalises and submits the caller's order.
 * V1 stub — returns static deterministic confirmation data.
 */
export async function runConfirmOrder(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  return {
    success:  true,
    order_id: 'order-local-001',
    status:   'confirmed',
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function confirmOrderTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: confirm_order route');
}
