import 'dotenv/config';
import { loadConfig } from './config/env.js';
import { createLogger } from './logger/index.js';
import { buildApp } from './app.js';
import { startVoiceRetryWorker } from './modules/voice/workers/voice-retry.worker.js';

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
}

main();
