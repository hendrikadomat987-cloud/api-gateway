// src/modules/voice/tools/restaurant/confirm-order.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';
import {
  findOrderContextBySessionId,
  confirmOrderContext,
} from '../../repositories/voice-order-contexts.repository.js';
import { finalizeRestaurantOrder } from '../../repositories/restaurant-order.repository.js';

/**
 * confirm_order
 *
 * Finalises the active order for this voice session:
 *   1. Sets restaurant_orders.status = 'confirmed'
 *   2. Sets voice_order_contexts.status = 'confirmed' + confirmed_at
 */
export async function runConfirmOrder(
  context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  const ctx = await findOrderContextBySessionId(context.tenantId, context.session.id);

  if (!ctx) {
    return { success: false, error: 'no_active_order' };
  }

  const json    = ctx.order_context_json as Record<string, unknown>;
  const orderId = json.restaurant_order_id as string | undefined;

  // Finalise restaurant_orders row if we have a real order
  if (orderId) {
    await finalizeRestaurantOrder(context.tenantId, orderId);
  }

  // Always confirm the voice context
  await confirmOrderContext(context.tenantId, context.session.id);

  return {
    success:  true,
    order_id: orderId ?? 'unknown',
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
