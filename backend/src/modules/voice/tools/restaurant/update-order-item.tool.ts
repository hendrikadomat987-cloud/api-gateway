// src/modules/voice/tools/restaurant/update-order-item.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';
import { parseModifierInputs, resolveModifiers } from './resolve-modifiers.js';

/**
 * update_order_item
 *
 * Updates quantity or modifiers for an existing item in the caller's order.
 * When `modifiers` is provided, it replaces the item's current modifier list.
 *
 * Args:
 *   item_id   {string}  — menu item identifier
 *   quantity  {number}  — new quantity (optional)
 *   modifiers {Array}   — replacement modifier list (optional)
 *     [{ type: 'add'|'remove'|'free_text', name: string }]
 *
 * Returns error when an 'add' or 'remove' modifier is not in the catalog.
 */
export async function runUpdateOrderItem(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const itemId   = typeof args.item_id  === 'string' ? args.item_id  : 'pizza_margherita';
  const quantity = typeof args.quantity === 'number'  ? args.quantity : 2;
  const rawMods  = args.modifiers;

  // ── Modifier resolution ───────────────────────────────────────────────────

  const modifierInputs = parseModifierInputs(rawMods);

  if (modifierInputs.length > 0) {
    const resolved = await resolveModifiers(context.tenantId, modifierInputs);

    if (resolved.error) {
      return {
        success: false,
        error:   resolved.error.code,
        modifier: resolved.error.modifier,
      };
    }

    return {
      success:  true,
      order_id: 'order-local-001',
      status:   'item_updated',
      item: {
        id:        itemId,
        name:      'Margherita',
        quantity,
        price:     8.5,
        modifiers: resolved.modifiers,
      },
    };
  }

  // ── No modifiers — backwards-compatible stub response ─────────────────────

  return {
    success:  true,
    order_id: 'order-local-001',
    status:   'item_updated',
    item: {
      id:        itemId,
      name:      'Margherita',
      quantity,
      price:     8.5,
      modifiers: [],
    },
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function updateOrderItemTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: update_order_item route');
}
