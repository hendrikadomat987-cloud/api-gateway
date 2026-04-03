// src/modules/voice/tools/restaurant/create-order.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * create_order
 *
 * Initialises a new order in the session context.
 * Order state is persisted in voice_order_contexts for the duration of the session.
 *
 * TODO: Implement order context initialisation.
 */
export async function runCreateOrder(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  throw new Error('Not implemented: create_order');
}

/** Route handler for direct HTTP invocation (testing only). */
export async function createOrderTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: create_order route');
}
