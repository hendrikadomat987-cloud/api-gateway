// src/modules/voice/tools/restaurant/create-order.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';
import { createRestaurantOrder } from '../../repositories/restaurant-order.repository.js';
import {
  findOrderContextBySessionId,
  upsertOrderContext,
} from '../../repositories/voice-order-contexts.repository.js';
import { validateDeliveryType, isDraftExpired } from './order-guards.js';

/**
 * create_order
 *
 * Creates a restaurant_orders row and links it to the voice session via
 * voice_order_contexts.
 *
 * Idempotency: if an active draft order already exists for this session,
 * the existing order is returned without modification.
 * A new order is only created when no context exists, or when the previous
 * order was already confirmed/cancelled (new session intent).
 *
 * Args:
 *   delivery_type         {'pickup'|'delivery'}  — defaults to 'pickup'
 *   customer_postal_code  {string}               — required for delivery at confirm time
 *   customer_name         {string}               — optional
 */
export async function runCreateOrder(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  // ── Input validation ────────────────────────────────────────────────────

  const deliveryTypeGuard = validateDeliveryType(args.delivery_type);
  if (deliveryTypeGuard) return deliveryTypeGuard;

  const deliveryType       = args.delivery_type === 'delivery' ? 'delivery' : 'pickup';
  const customerPostalCode = typeof args.customer_postal_code === 'string' ? args.customer_postal_code : null;
  const customerName       = typeof args.customer_name        === 'string' ? args.customer_name        : null;

  // ── Idempotency: reuse existing draft ───────────────────────────────────

  const existing = await findOrderContextBySessionId(context.tenantId, context.session.id);

  if (existing && existing.status === 'draft' && !isDraftExpired(existing)) {
    // Active, non-expired draft exists — return it without overwriting items
    const json    = existing.order_context_json as Record<string, unknown>;
    const orderId = json.restaurant_order_id as string | undefined;
    return {
      success:       true,
      order_id:      orderId ?? 'unknown',
      status:        'reused',
      delivery_type: (json.delivery_type as string | undefined) ?? 'pickup',
      message:       'An active order already exists for this session. Use the existing order.',
    };
  }

  // ── Create new order ────────────────────────────────────────────────────

  const orderId = await createRestaurantOrder(context.tenantId, {
    source:             'voice',
    status:             'draft',
    totalCents:         0,
    deliveryType,
    customerPostalCode,
    customerName,
  });

  await upsertOrderContext(
    context.tenantId,
    context.call.id,
    context.session.id,
    {
      restaurant_order_id:  orderId,
      items:                [],
      status:               'draft',
      delivery_type:        deliveryType,
      customer_postal_code: customerPostalCode,
      customer_name:        customerName,
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
