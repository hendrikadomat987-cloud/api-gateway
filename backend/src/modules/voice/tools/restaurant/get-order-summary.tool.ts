// src/modules/voice/tools/restaurant/get-order-summary.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';
import {
  findOrderContextBySessionId,
} from '../../repositories/voice-order-contexts.repository.js';
import { calculateTotals } from './order-rules.js';
import type { ContextItem } from './reference-resolver.js';

/**
 * get_order_summary
 *
 * Returns the current order contents and calculated totals from
 * order_context_json. Always reads from the voice session context —
 * no extra DB query needed.
 */
export async function runGetOrderSummary(
  context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  const ctx = await findOrderContextBySessionId(context.tenantId, context.session.id);

  if (!ctx) {
    return {
      success:     true,
      has_order:   false,
      items:       [],
      item_count:  0,
      subtotal_cents: 0,
      delivery_fee_cents: 0,
      total_cents: 0,
    };
  }

  const json         = ctx.order_context_json as Record<string, unknown>;
  const items        = (json.items as ContextItem[] | undefined) ?? [];
  const orderId      = json.restaurant_order_id as string | undefined;
  const deliveryType = (json.delivery_type as string | undefined) ?? 'pickup';
  const postalCode   = json.customer_postal_code as string | undefined;
  const orderStatus  = json.status as string | undefined;

  const totals = calculateTotals(items, 0); // delivery fee finalised at confirm

  const summaryItems = items.map((item, idx) => ({
    position:   idx + 1,
    id:         item.order_item_id ?? item.item_id,
    name:       item.name,
    quantity:   item.quantity,
    unit_price: item.unit_price,
    modifiers:  item.modifiers,
    line_total: item.line_total,
  }));

  return {
    success:            true,
    has_order:          true,
    order_id:           orderId ?? 'unknown',
    status:             orderStatus ?? 'draft',
    delivery_type:      deliveryType,
    customer_postal_code: postalCode ?? null,
    items:              summaryItems,
    item_count:         items.length,
    subtotal_cents:     totals.subtotal_cents,
    delivery_fee_cents: 0,   // unknown until confirmed; caller should use confirm_order for final fee
    total_cents:        totals.subtotal_cents,
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function getOrderSummaryTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: get_order_summary route');
}
