import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthError } from '../errors/index.js';

/**
 * Verifies the Bearer JWT on every protected route.
 *
 * Use as a preHandler:
 *   fastify.addHook('preHandler', authenticate)
 * or per-route:
 *   { preHandler: [authenticate] }
 */
export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new AuthError('Invalid or missing token', 'UNAUTHORIZED');
  }
}
