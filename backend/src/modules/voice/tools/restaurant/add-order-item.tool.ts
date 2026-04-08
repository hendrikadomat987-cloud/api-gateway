// src/modules/voice/tools/restaurant/add-order-item.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';
import { parseModifierInputs, resolveModifiers } from './resolve-modifiers.js';

/**
 * add_order_item
 *
 * Adds a menu item to the caller's active order.
 * Accepts an optional `modifiers` array and validates it against the catalog.
 *
 * Args:
 *   item_id   {string}  — menu item identifier (stub-tolerant)
 *   quantity  {number}  — defaults to 1
 *   modifiers {Array}   — optional modifier list
 *     [{ type: 'add'|'remove'|'free_text', name: string }]
 *
 * Returns error when an 'add' or 'remove' modifier is not in the catalog.
 */
export async function runAddOrderItem(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const itemId   = typeof args.item_id  === 'string' ? args.item_id  : 'pizza_margherita';
  const quantity = typeof args.quantity === 'number'  ? args.quantity : 1;
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

    // Return item with resolved modifiers
    return {
      success:  true,
      order_id: 'order-local-001',
      status:   'item_added',
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
    status:   'item_added',
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
export async function addOrderItemTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: add_order_item route');
}
