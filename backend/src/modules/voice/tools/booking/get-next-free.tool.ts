// src/modules/voice/tools/booking/get-next-free.tool.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceContext } from '../../../../types/voice.js';

/**
 * get_next_free
 *
 * Returns the next available appointment slot from a given point in time.
 *
 * TODO: Implement availability-engine integration.
 */
export async function runGetNextFree(
  _context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  throw new Error('Not implemented: get_next_free');
}

/** Route handler for direct HTTP invocation (testing only). */
export async function getNextFreeTool(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented: get_next_free route');
}
