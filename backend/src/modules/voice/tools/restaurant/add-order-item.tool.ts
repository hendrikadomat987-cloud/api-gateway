// src/modules/voice/tools/restaurant/add-order-item.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext, OrderItemModifier } from '../../../../types/voice.js';
import { parseModifierInputs, resolveModifiers } from './resolve-modifiers.js';
import {
  findOrderContextBySessionId,
  upsertOrderContext,
} from '../../repositories/voice-order-contexts.repository.js';
import {
  createRestaurantOrder,
  addRestaurantOrderItem,
  updateOrderTotals,
} from '../../repositories/restaurant-order.repository.js';
import { findMenuItemById } from '../../repositories/restaurant-menu.repository.js';
import { calculateTotals } from './order-rules.js';
import {
  isUuid,
  isNochmalRef,
  type ContextItem,
} from './reference-resolver.js';
import { guardDraftState, validateQuantity } from './order-guards.js';

// ── Tool entry point ──────────────────────────────────────────────────────────

/**
 * add_order_item
 *
 * Adds a menu item to the active order for this voice session.
 * Auto-creates an order context if none exists yet.
 *
 * Args:
 *   item_id   {string}  — menu item UUID, "nochmal" (repeat last), or ignored
 *   quantity  {number}  — defaults to 1
 *   modifiers {Array}   — optional: [{ type, name }]
 *
 * Special values for item_id:
 *   "nochmal" / "noch eins" / "das gleiche" — clones the last context item
 *     as a new line (same menu_item_id + modifiers, ignores quantity arg).
 */
export async function runAddOrderItem(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const itemId = typeof args.item_id === 'string' ? args.item_id.trim() : '';

  // Quantity: default 1 when not provided; validate when explicitly provided
  const rawQty   = args.quantity;
  const quantity = rawQty === undefined ? 1 : (typeof rawQty === 'number' ? rawQty : NaN);
  if (rawQty !== undefined) {
    const qErr = validateQuantity(rawQty);
    if (qErr) return qErr;
  }

  // Validate modifiers first — fail early before any DB writes
  const modifierInputs = parseModifierInputs(args.modifiers);
  if (modifierInputs.length > 0) {
    const resolved = await resolveModifiers(context.tenantId, modifierInputs);
    if (resolved.error) {
      return { success: false, error: resolved.error.code, modifier: resolved.error.modifier };
    }
    return _doAddItem(context, itemId, quantity, resolved.modifiers);
  }

  return _doAddItem(context, itemId, quantity, []);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _doAddItem(
  context: VoiceContext,
  itemId: string,
  quantity: number,
  modifiers: OrderItemModifier[],
): Promise<unknown> {
  // 1. Get or auto-create order context
  let ctx = await findOrderContextBySessionId(context.tenantId, context.session.id);

  // Guard: block mutations on confirmed/terminal orders
  if (ctx) {
    const stateErr = guardDraftState(ctx);
    if (stateErr) return stateErr;
  }

  let orderId: string;
  let items: ContextItem[];

  if (!ctx) {
    orderId = await createRestaurantOrder(context.tenantId, {
      source: 'voice', status: 'draft', totalCents: 0,
    });
    ctx = await upsertOrderContext(
      context.tenantId, context.call.id, context.session.id,
      { restaurant_order_id: orderId, items: [], status: 'draft' },
    );
    items = [];
  } else {
    const json = ctx.order_context_json as Record<string, unknown>;
    orderId = json.restaurant_order_id as string;
    items   = (json.items as ContextItem[] | undefined) ?? [];
  }

  // 2. Handle "nochmal" — clone last context item as a new line
  if (isNochmalRef(itemId)) {
    if (items.length === 0) {
      return { success: false, error: 'empty_order', reason: 'no item to repeat' };
    }
    const last = items[items.length - 1];
    return _doAddItem(
      context,
      last.menu_item_id ?? last.item_id,
      1,                // always quantity 1 per repeat
      last.modifiers,   // copy modifiers from original
    );
  }

  // 3. Try to resolve real menu item (only when item_id is a UUID)
  const menuItem = isUuid(itemId)
    ? await findMenuItemById(context.tenantId, itemId)
    : null;

  // 4. Calculate per-unit price
  const basePriceCents     = menuItem?.price_cents ?? 0;
  const modifierExtraCents = modifiers.reduce((sum, m) => sum + Math.round(m.price_delta * 100), 0);
  const unitPriceCents     = basePriceCents + modifierExtraCents;
  const lineTotalCents     = unitPriceCents * quantity;

  // 5. Persist to restaurant_order_items if menu item resolved
  let orderItemId: string | null = null;
  if (menuItem) {
    orderItemId = await addRestaurantOrderItem(context.tenantId, orderId, {
      menuItemId:              menuItem.id,
      nameSnapshot:            menuItem.name,
      quantity,
      priceCents:              unitPriceCents,
      prepTimeSecondsSnapshot: menuItem.prep_time_seconds,
      modifiersJson:           modifiers,
    });
  }

  // 6. Build new context item
  const newItem: ContextItem = {
    order_item_id: orderItemId,
    item_id:       itemId,
    menu_item_id:  menuItem?.id ?? null,
    name:          menuItem?.name ?? itemId,
    quantity,
    unit_price:    unitPriceCents / 100,
    modifiers,
    line_total:    lineTotalCents / 100,
  };

  const updatedItems = [...items, newItem];

  // 7. Recalculate order totals
  const totals = calculateTotals(updatedItems, 0); // delivery fee applied at confirm
  if (menuItem) {
    await updateOrderTotals(context.tenantId, orderId, {
      subtotalCents:    totals.subtotal_cents,
      deliveryFeeCents: 0,
      totalCents:       totals.subtotal_cents,
    });
  }

  // 8. Persist updated context with enrichment fields
  await upsertOrderContext(
    context.tenantId, context.call.id, context.session.id,
    {
      ...(ctx.order_context_json as Record<string, unknown>),
      items:               updatedItems,
      last_added_item_id:  orderItemId ?? itemId,
    },
  );

  return {
    success:        true,
    order_id:       orderId,
    status:         'item_added',
    subtotal_cents: totals.subtotal_cents,
    total_cents:    totals.subtotal_cents,
    item: {
      id:          orderItemId ?? itemId,
      menu_item_id: menuItem?.id ?? null,
      name:        menuItem?.name ?? itemId,
      quantity,
      price:       unitPriceCents / 100,
      modifiers,
      line_total:  lineTotalCents / 100,
    },
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function addOrderItemTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: add_order_item route');
}
