// src/modules/voice/tools/restaurant/get-menu.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * get_menu
 *
 * Returns the full menu for the tenant's restaurant.
 * V1 stub — returns static deterministic menu data.
 */
export async function runGetMenu(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  return {
    success: true,
    categories: [
      {
        name: 'Pizza',
        items: [
          { id: 'pizza_margherita', name: 'Margherita', price: 8.5 },
          { id: 'pizza_salame',     name: 'Salami',     price: 9.5 },
        ],
      },
      {
        name: 'Drinks',
        items: [
          { id: 'cola', name: 'Cola', price: 2.5 },
        ],
      },
    ],
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function getMenuTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: get_menu route');
}
