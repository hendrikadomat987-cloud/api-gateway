// src/modules/voice/tools/restaurant/remove-order-item.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';
import {
  findOrderContextBySessionId,
  upsertOrderContext,
} from '../../repositories/voice-order-contexts.repository.js';
import {
  deleteRestaurantOrderItem,
  updateOrderTotals,
} from '../../repositories/restaurant-order.repository.js';
import { calculateTotals } from './order-rules.js';
import { resolveItemReference, isUuid, type ContextItem } from './reference-resolver.js';

/**
 * remove_order_item
 *
 * Removes an item from the active order. The item can be identified by:
 *   - UUID (exact item_id or order_item_id)
 *   - Positional reference ("die erste", "die zweite", "das letzte")
 *   - Name query ("margherita", "salami")
 *
 * Args:
 *   item_id {string} — item identifier or reference string
 */
export async function runRemoveOrderItem(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const ref = typeof args.item_id === 'string' ? args.item_id.trim() : '';

  const ctx = await findOrderContextBySessionId(context.tenantId, context.session.id);
  if (!ctx) {
    return { success: false, error: 'no_active_order' };
  }

  const json    = ctx.order_context_json as Record<string, unknown>;
  const orderId = json.restaurant_order_id as string;
  const items   = ((json.items as ContextItem[] | undefined) ?? []).slice();

  if (items.length === 0) {
    return { success: false, error: 'empty_order' };
  }

  // ── Resolve reference to an index ────────────────────────────────────────

  let idx: number;

  if (isUuid(ref)) {
    // Exact UUID match: check item_id and order_item_id
    idx = items.findIndex((i) => i.item_id === ref || i.order_item_id === ref);
    if (idx === -1) {
      return { success: false, error: 'item_not_found', item_id: ref };
    }
  } else {
    const resolved = resolveItemReference(items, ref);
    if (resolved.error) {
      return { success: false, error: resolved.error, item_id: ref };
    }
    idx = resolved.index;
  }

  const removed = items[idx];

  // ── Delete DB row if present ──────────────────────────────────────────────

  if (removed.order_item_id) {
    await deleteRestaurantOrderItem(context.tenantId, removed.order_item_id);
  }

  // ── Update context ────────────────────────────────────────────────────────

  const updatedItems = items.filter((_, i) => i !== idx);
  const totals       = calculateTotals(updatedItems, 0);

  if (orderId) {
    await updateOrderTotals(context.tenantId, orderId, {
      subtotalCents:    totals.subtotal_cents,
      deliveryFeeCents: 0,
      totalCents:       totals.subtotal_cents,
    });
  }

  await upsertOrderContext(
    context.tenantId, context.call.id, context.session.id,
    { ...json, items: updatedItems },
  );

  return {
    success:        true,
    status:         'item_removed',
    order_id:       orderId ?? 'unknown',
    removed_item:   { id: removed.order_item_id ?? removed.item_id, name: removed.name },
    subtotal_cents: totals.subtotal_cents,
    total_cents:    totals.subtotal_cents,
    remaining_items: updatedItems.length,
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function removeOrderItemTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: remove_order_item route');
}
