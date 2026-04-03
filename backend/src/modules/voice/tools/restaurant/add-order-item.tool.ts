// src/modules/voice/tools/restaurant/add-order-item.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * add_order_item
 *
 * Adds a menu item to the caller's active order.
 *
 * TODO: Implement order item mutation on voice_order_contexts.
 */
export async function runAddOrderItem(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  throw new Error('Not implemented: add_order_item');
}

/** Route handler for direct HTTP invocation (testing only). */
export async function addOrderItemTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: add_order_item route');
}
