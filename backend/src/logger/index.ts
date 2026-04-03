import pino from 'pino';
import type { Config } from '../config/env.js';

/**
 * Creates the root pino logger. The same instance is passed to Fastify as
 * `loggerInstance` so all request logs share the same config.
 */
export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>): pino.Logger {
  const isDev = config.NODE_ENV === 'development';

  return pino({
    level: config.LOG_LEVEL,
    ...(isDev && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    }),
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  });
}
