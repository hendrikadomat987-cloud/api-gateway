// src/modules/voice/tools/restaurant/get-menu.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * get_menu
 *
 * Returns the full menu for the tenant's restaurant.
 *
 * TODO: Implement menu data source integration.
 */
export async function runGetMenu(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  throw new Error('Not implemented: get_menu');
}

/** Route handler for direct HTTP invocation (testing only). */
export async function getMenuTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: get_menu route');
}
