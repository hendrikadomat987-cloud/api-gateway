// src/modules/voice/tools/restaurant/add-order-item.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext, OrderItemModifier } from '../../../../types/voice.js';
import { parseModifierInputs, resolveModifiers } from './resolve-modifiers.js';
import {
  findOrderContextBySessionId,
  upsertOrderContext,
} from '../../repositories/voice-order-contexts.repository.js';
import { createRestaurantOrder, addRestaurantOrderItem } from '../../repositories/restaurant-order.repository.js';
import { findMenuItemById } from '../../repositories/restaurant-menu.repository.js';

// ── Local type for items stored in order_context_json ─────────────────────────

interface ContextItem {
  order_item_id: string | null;
  item_id:       string;
  menu_item_id:  string | null;
  name:          string;
  quantity:      number;
  unit_price:    number;
  modifiers:     OrderItemModifier[];
  line_total:    number;
}

// ── Tool entry point ──────────────────────────────────────────────────────────

/**
 * add_order_item
 *
 * Adds a menu item to the active order for this voice session.
 * Auto-creates an order context if none exists yet.
 *
 * Args:
 *   item_id   {string}  — menu item UUID (or legacy stub ID)
 *   quantity  {number}  — defaults to 1
 *   modifiers {Array}   — optional: [{ type, name }]
 *
 * When item_id is a real UUID present in restaurant_menu_items, a real
 * restaurant_order_items row is created and order_item_id is returned.
 * Otherwise (legacy stub IDs) the item is stored in context_json only.
 */
export async function runAddOrderItem(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const itemId   = typeof args.item_id  === 'string' ? args.item_id  : '';
  const quantity = typeof args.quantity === 'number'  ? args.quantity : 1;

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

  // 2. Try to resolve real menu item (only when item_id looks like a UUID)
  const menuItem = _isUuid(itemId)
    ? await findMenuItemById(context.tenantId, itemId)
    : null;

  // 3. Calculate per-unit price
  const basePriceCents     = menuItem?.price_cents ?? 0;
  const modifierExtraCents = modifiers.reduce((sum, m) => sum + Math.round(m.price_delta * 100), 0);
  const unitPriceCents     = basePriceCents + modifierExtraCents;
  const lineTotalCents     = unitPriceCents * quantity;

  // 4. Persist to restaurant_order_items if menu item resolved
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

  // 5. Update context_json (truth for UI / voice agent)
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

  await upsertOrderContext(
    context.tenantId, context.call.id, context.session.id,
    {
      ...(ctx.order_context_json as Record<string, unknown>),
      items: [...items, newItem],
    },
  );

  // 6. Return
  return {
    success:  true,
    order_id: orderId,
    status:   'item_added',
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

function _isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Route handler for direct HTTP invocation (testing only). */
export async function addOrderItemTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: add_order_item route');
}
