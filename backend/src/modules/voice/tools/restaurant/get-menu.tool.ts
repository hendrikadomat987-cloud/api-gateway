// src/modules/voice/tools/restaurant/get-menu.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';
import { getMenuByTenant } from '../../repositories/restaurant-menu.repository.js';

/**
 * get_menu
 *
 * Returns the full active menu for the tenant's restaurant from the DB.
 * Categories and items are ordered by sort_order.
 */
export async function runGetMenu(
  context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  const categories = await getMenuByTenant(context.tenantId);

  return {
    success:    true,
    categories,
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function getMenuTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: get_menu route');
}
