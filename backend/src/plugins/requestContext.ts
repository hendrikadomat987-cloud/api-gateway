import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

/**
 * Assigns a unique request ID to every incoming request.
 *
 * Priority: X-Request-Id header → generated UUID.
 * The ID is echoed back on every response via the X-Request-Id header so
 * callers can correlate logs.
 */
export const requestContextPlugin = fp(async (app: FastifyInstance) => {
  app.addHook('onRequest', async (request, reply) => {
    const fromHeader = request.headers['x-request-id'];
    const id = typeof fromHeader === 'string' && fromHeader.length > 0
      ? fromHeader
      : randomUUID();

    // Override Fastify's default id with our chosen value
    (request as unknown as { id: string }).id = id;

    reply.header('x-request-id', id);
  });
});
