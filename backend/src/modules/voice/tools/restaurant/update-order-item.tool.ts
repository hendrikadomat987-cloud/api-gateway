// src/modules/voice/tools/restaurant/update-order-item.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * update_order_item
 *
 * Updates quantity or modifications for an existing item in the caller's order.
 *
 * TODO: Implement order item mutation on voice_order_contexts.
 */
export async function runUpdateOrderItem(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  return {
    success:  true,
    order_id: 'order-local-001',
    status:   'item_updated',
    item: {
      id:       'pizza_margherita',
      name:     'Margherita',
      quantity: 2,
      price:    8.5,
    },
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function updateOrderItemTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: update_order_item route');
}
