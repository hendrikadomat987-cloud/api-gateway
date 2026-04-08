// src/modules/voice/tools/restaurant/search-menu-item.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';
import { searchMenuItems } from '../../repositories/restaurant-menu.repository.js';

/**
 * search_menu_item
 *
 * Searches the tenant's active menu for items matching a caller's query.
 * Case-insensitive match on name and description.
 * Returns an empty items array when nothing matches — never fabricates results.
 */
export async function runSearchMenuItem(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const query = typeof args?.query === 'string' && args.query.trim().length > 0
    ? args.query.trim()
    : '';

  if (!query) {
    return {
      success: false,
      query,
      error:   'query argument is required',
      items:   [],
    };
  }

  const items = await searchMenuItems(context.tenantId, query);

  return {
    success: true,
    query,
    items,
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function searchMenuItemTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: search_menu_item route');
}
