import 'dotenv/config';
import { loadConfig } from './config/env.js';
import { createLogger } from './logger/index.js';
import { buildApp } from './app.js';
import { startVoiceRetryWorker, stopVoiceRetryWorker } from './modules/voice/workers/voice-retry.worker.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  const app = await buildApp({ config, logger });

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Tenant Core started');
    startVoiceRetryWorker(config);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutdown signal received, stopping server');
    stopVoiceRetryWorker();
    app.close().then(() => {
      logger.info('server closed');
      process.exit(0);
    }).catch((err) => {
      logger.error({ err }, 'error during server close');
      process.exit(1);
    });
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT',  () => shutdown('SIGINT'));
}

main();
