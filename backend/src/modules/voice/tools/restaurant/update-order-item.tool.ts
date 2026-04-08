// src/modules/voice/tools/restaurant/update-order-item.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext, OrderItemModifier } from '../../../../types/voice.js';
import { parseModifierInputs, resolveModifiers } from './resolve-modifiers.js';
import {
  findOrderContextBySessionId,
  upsertOrderContext,
} from '../../repositories/voice-order-contexts.repository.js';
import { updateRestaurantOrderItem, updateOrderTotals } from '../../repositories/restaurant-order.repository.js';
import { findMenuItemById } from '../../repositories/restaurant-menu.repository.js';
import { calculateTotals } from './order-rules.js';
import {
  resolveItemReference,
  isUuid,
  type ContextItem,
} from './reference-resolver.js';

/**
 * update_order_item
 *
 * Updates quantity and/or modifiers for an existing item in the active order.
 *
 * Args:
 *   item_id   {string}  — item UUID, order_item_id, positional ref ("die zweite"),
 *                         or name query ("margherita")
 *   quantity  {number}  — new quantity (optional)
 *   modifiers {Array}   — replacement modifier list (optional)
 */
export async function runUpdateOrderItem(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const itemId   = typeof args.item_id  === 'string' ? args.item_id.trim() : '';
  const quantity = typeof args.quantity === 'number'  ? args.quantity : undefined;

  // Validate modifiers
  const modifierInputs = parseModifierInputs(args.modifiers);
  if (modifierInputs.length > 0) {
    const resolved = await resolveModifiers(context.tenantId, modifierInputs);
    if (resolved.error) {
      return { success: false, error: resolved.error.code, modifier: resolved.error.modifier };
    }
    return _doUpdateItem(context, itemId, quantity, resolved.modifiers);
  }

  return _doUpdateItem(context, itemId, quantity, modifierInputs.length > 0 ? [] : undefined);
}

async function _doUpdateItem(
  context: VoiceContext,
  itemId: string,
  quantity: number | undefined,
  modifiers: OrderItemModifier[] | undefined,
): Promise<unknown> {
  const ctx = await findOrderContextBySessionId(context.tenantId, context.session.id);

  if (!ctx) {
    return { success: false, error: 'no_active_order' };
  }

  const json    = ctx.order_context_json as Record<string, unknown>;
  const orderId = json.restaurant_order_id as string;
  const items   = ((json.items as ContextItem[] | undefined) ?? []).slice();

  // ── Resolve item index ──────────────────────────────────────────────────

  let idx: number;

  if (isUuid(itemId)) {
    // Exact UUID: match item_id OR order_item_id (last occurrence)
    idx = _lastUuidIndexOf(items, itemId);
    if (idx === -1) {
      return { success: false, error: 'item_not_found', item_id: itemId };
    }
  } else {
    const resolved = resolveItemReference(items, itemId);
    if (resolved.error) {
      return { success: false, error: resolved.error, item_id: itemId };
    }
    idx = resolved.index;
    if (idx === -1) {
      return { success: false, error: 'item_not_found', item_id: itemId };
    }
  }

  const existing = { ...items[idx] };

  // ── Apply updates ───────────────────────────────────────────────────────

  if (quantity  !== undefined) existing.quantity  = quantity;
  if (modifiers !== undefined) existing.modifiers = modifiers;

  // Recalculate price if menu item is known
  if (existing.menu_item_id) {
    const menuItem = await findMenuItemById(context.tenantId, existing.menu_item_id);
    if (menuItem) {
      const basePriceCents     = menuItem.price_cents;
      const modifierExtraCents = existing.modifiers.reduce(
        (sum, m) => sum + Math.round(m.price_delta * 100), 0,
      );
      const unitPriceCents = basePriceCents + modifierExtraCents;
      existing.unit_price  = unitPriceCents / 100;
      existing.line_total  = (unitPriceCents * existing.quantity) / 100;

      if (existing.order_item_id) {
        await updateRestaurantOrderItem(context.tenantId, existing.order_item_id, {
          quantity:      existing.quantity,
          priceCents:    unitPriceCents,
          modifiersJson: existing.modifiers,
        });
      }
    }
  } else {
    existing.line_total = existing.unit_price * existing.quantity;
  }

  // ── Recalculate order totals ────────────────────────────────────────────

  items[idx] = existing;
  const totals = calculateTotals(items, 0);

  if (orderId && existing.order_item_id) {
    await updateOrderTotals(context.tenantId, orderId, {
      subtotalCents:    totals.subtotal_cents,
      deliveryFeeCents: 0,
      totalCents:       totals.subtotal_cents,
    });
  }

  // ── Persist context with enrichment ────────────────────────────────────

  await upsertOrderContext(
    context.tenantId, context.call.id, context.session.id,
    {
      ...json,
      items,
      last_updated_item_id: existing.order_item_id ?? existing.item_id,
    },
  );

  return {
    success:        true,
    order_id:       orderId,
    status:         'item_updated',
    subtotal_cents: totals.subtotal_cents,
    total_cents:    totals.subtotal_cents,
    item: {
      id:          existing.order_item_id ?? existing.item_id,
      menu_item_id: existing.menu_item_id,
      name:        existing.name,
      quantity:    existing.quantity,
      price:       existing.unit_price,
      modifiers:   existing.modifiers,
      line_total:  existing.line_total,
    },
  };
}

/** Returns index of last item matching by item_id OR order_item_id (UUID path). */
function _lastUuidIndexOf(items: ContextItem[], id: string): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].item_id === id || items[i].order_item_id === id) return i;
  }
  return -1;
}

/** Route handler for direct HTTP invocation (testing only). */
export async function updateOrderItemTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: update_order_item route');
}
