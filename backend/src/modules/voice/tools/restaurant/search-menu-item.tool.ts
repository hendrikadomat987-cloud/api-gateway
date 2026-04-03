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
  throw new Error('Not implemented: search_menu_item');
}

/** Route handler for direct HTTP invocation (testing only). */
export async function searchMenuItemTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: search_menu_item route');
}
