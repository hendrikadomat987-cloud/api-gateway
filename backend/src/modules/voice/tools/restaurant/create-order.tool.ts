// src/modules/voice/tools/restaurant/create-order.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * create_order
 *
 * Initialises a new order in the session context.
 * V1 stub — returns static deterministic order data.
 */
export async function runCreateOrder(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  return {
    success: true,
    order_id: 'order-local-001',
    status:   'created',
  };
}

/** Route handler for direct HTTP invocation (testing only). */
export async function createOrderTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: create_order route');
}
