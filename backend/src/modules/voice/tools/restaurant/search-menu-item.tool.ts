// src/modules/voice/tools/restaurant/search-menu-item.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * search_menu_item
 *
 * Searches the menu for items matching a caller's query.
 *
 * TODO: Implement menu search integration.
 */
export async function runSearchMenuItem(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  return {
    success: true,
    query:   typeof _args?.query === 'string' ? _args.query : 'pizza',
    items: [
      { id: 'pizza_margherita', name: 'Margherita', price: 8.5,  category: 'Pizza' },
      { id: 'pizza_salame',     name: 'Salami',     price: 9.5,  category: 'Pizza' },
    ],
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function searchMenuItemTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: search_menu_item route');
}
