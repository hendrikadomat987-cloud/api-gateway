// src/modules/voice/tools/restaurant/confirm-order.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';
import {
  findOrderContextBySessionId,
  confirmOrderContext,
} from '../../repositories/voice-order-contexts.repository.js';
import { finalizeRestaurantOrder, updateOrderTotals } from '../../repositories/restaurant-order.repository.js';
import { calculateTotals, validateDeliveryRules } from './order-rules.js';

interface ContextItem {
  line_total: number;
}

/**
 * confirm_order
 *
 * Finalises the active order for this voice session:
 *   1. Validates delivery zone + min order (if delivery_type === 'delivery')
 *   2. Persists final totals (subtotal, delivery fee, grand total) to restaurant_orders
 *   3. Sets restaurant_orders.status = 'confirmed'
 *   4. Sets voice_order_contexts.status = 'confirmed' + confirmed_at
 */
export async function runConfirmOrder(
  context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  const ctx = await findOrderContextBySessionId(context.tenantId, context.session.id);

  if (!ctx) {
    return { success: false, error: 'no_active_order' };
  }

  const json        = ctx.order_context_json as Record<string, unknown>;
  const orderId     = json.restaurant_order_id as string | undefined;
  const items       = (json.items as ContextItem[] | undefined) ?? [];
  const deliveryType = (json.delivery_type as string | undefined) ?? 'pickup';
  const postalCode  = json.customer_postal_code as string | undefined;

  // 1. Calculate subtotal
  const subtotalOnly = calculateTotals(items, 0);
  const subtotalCents = subtotalOnly.subtotal_cents;

  // 2. Delivery validation
  let deliveryFeeCents = 0;
  if (deliveryType === 'delivery') {
    const validation = await validateDeliveryRules(context.tenantId, postalCode, subtotalCents);
    if (!validation.valid) {
      return {
        success:           false,
        error:             validation.error,
        delivery_fee_cents: validation.delivery_fee_cents,
        min_order_cents:   validation.min_order_cents,
      };
    }
    deliveryFeeCents = validation.delivery_fee_cents;
  }

  const totalCents = subtotalCents + deliveryFeeCents;

  // 3. Persist final totals + finalize restaurant_orders row
  if (orderId) {
    await updateOrderTotals(context.tenantId, orderId, {
      subtotalCents,
      deliveryFeeCents,
      totalCents,
    });
    await finalizeRestaurantOrder(context.tenantId, orderId);
  }

  // 4. Confirm voice context
  await confirmOrderContext(context.tenantId, context.session.id);

  return {
    success:            true,
    order_id:           orderId ?? 'unknown',
    status:             'confirmed',
    subtotal_cents:     subtotalCents,
    delivery_fee_cents: deliveryFeeCents,
    total_cents:        totalCents,
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function confirmOrderTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: confirm_order route');
}
