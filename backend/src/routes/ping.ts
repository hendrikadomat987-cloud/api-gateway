import type { FastifyInstance } from 'fastify';

export async function pingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ping', async (_request, reply) => {
    reply.send({ status: 'ok' });
  });
}
