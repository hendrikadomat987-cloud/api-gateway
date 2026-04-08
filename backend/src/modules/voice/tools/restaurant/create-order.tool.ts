// src/modules/voice/tools/restaurant/create-order.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';
import { createRestaurantOrder } from '../../repositories/restaurant-order.repository.js';
import { upsertOrderContext } from '../../repositories/voice-order-contexts.repository.js';

/**
 * create_order
 *
 * Creates a real restaurant_orders row and links it to the voice session
 * via voice_order_contexts. Returns the DB-generated order UUID.
 */
export async function runCreateOrder(
  context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  // 1. Create real order in restaurant_orders
  const orderId = await createRestaurantOrder(context.tenantId, {
    source:     'voice',
    status:     'draft',
    totalCents: 0,
  });

  // 2. Link order to voice session via voice_order_contexts
  await upsertOrderContext(
    context.tenantId,
    context.call.id,
    context.session.id,
    { restaurant_order_id: orderId, items: [], status: 'draft' },
  );

  return {
    success:  true,
    order_id: orderId,
    status:   'created',
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function createOrderTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: create_order route');
}
