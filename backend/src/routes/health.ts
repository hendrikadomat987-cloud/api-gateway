import type { FastifyInstance } from 'fastify';

const { version } = process.env['npm_package_version']
  ? { version: process.env['npm_package_version'] }
  : { version: '0.1.0' };

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status:    { type: 'string' },
              timestamp: { type: 'string' },
              version:   { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      reply.send({
        status:    'ok',
        timestamp: new Date().toISOString(),
        version,
      });
    },
  );
}
