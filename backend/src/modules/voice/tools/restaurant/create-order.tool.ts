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
 *
 * Args:
 *   delivery_type         {'pickup'|'delivery'}  — defaults to 'pickup'
 *   customer_postal_code  {string}               — required for delivery
 *   customer_name         {string}               — optional
 */
export async function runCreateOrder(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const deliveryType       = args.delivery_type        === 'delivery' ? 'delivery' : 'pickup';
  const customerPostalCode = typeof args.customer_postal_code === 'string' ? args.customer_postal_code : null;
  const customerName       = typeof args.customer_name        === 'string' ? args.customer_name        : null;

  // 1. Create real order in restaurant_orders
  const orderId = await createRestaurantOrder(context.tenantId, {
    source:             'voice',
    status:             'draft',
    totalCents:         0,
    deliveryType,
    customerPostalCode,
    customerName,
  });

  // 2. Link order to voice session via voice_order_contexts
  await upsertOrderContext(
    context.tenantId,
    context.call.id,
    context.session.id,
    {
      restaurant_order_id:   orderId,
      items:                 [],
      status:                'draft',
      delivery_type:         deliveryType,
      customer_postal_code:  customerPostalCode,
      customer_name:         customerName,
    },
  );

  return {
    success:       true,
    order_id:      orderId,
    status:        'created',
    delivery_type: deliveryType,
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function createOrderTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: create_order route');
}
