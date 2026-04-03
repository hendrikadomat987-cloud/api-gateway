// src/modules/voice/workers/voice-retry.worker.ts
import type { Config } from '../../../config/env.js';
import { serviceLogger } from '../../../logger/index.js';
import {
  listDistinctTenantsWithFailedEvents,
  listFailedEvents,
  incrementRetryCount,
  markEventDeadLetter,
} from '../repositories/voice-events.repository.js';
import { replayFailedEvent } from '../services/voice-orchestration.service.js';

const log = serviceLogger.child({ name: 'voice.retry-worker' });

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Starts a background interval that periodically replays failed voice events.
 * An initial batch run is executed immediately on start.
 *
 * Discovery of which tenants have failed events uses the DB connection's default
 * role (listDistinctTenantsWithFailedEvents). All actual event loading and replay
 * is tenant-scoped via withTenant() inside listFailedEvents() and replayFailedEvent().
 *
 * The worker is a no-op when VOICE_RETRY_ENABLED is false.
 * Errors inside a batch run are caught and logged — they never crash the server.
 */
export function startVoiceRetryWorker(
  config: Pick<Config, 'VOICE_RETRY_ENABLED' | 'VOICE_RETRY_INTERVAL_MS' | 'VOICE_RETRY_BATCH_SIZE' | 'VOICE_RETRY_MAX_ATTEMPTS'>,
): void {
  if (!config.VOICE_RETRY_ENABLED) {
    log.info('voice retry worker disabled');
    return;
  }

  if (intervalHandle !== null) {
    log.warn('voice retry worker: start called but worker is already running');
    return;
  }

  log.info(
    {
      intervalMs:  config.VOICE_RETRY_INTERVAL_MS,
      batchSize:   config.VOICE_RETRY_BATCH_SIZE,
      maxAttempts: config.VOICE_RETRY_MAX_ATTEMPTS,
    },
    'voice retry worker started',
  );

  // Run immediately once, then on each subsequent interval
  runRetryBatch(config.VOICE_RETRY_BATCH_SIZE, config.VOICE_RETRY_MAX_ATTEMPTS).catch((err) => {
    log.error({ err }, 'voice retry worker: unhandled error in initial batch run');
  });

  intervalHandle = setInterval(() => {
    runRetryBatch(config.VOICE_RETRY_BATCH_SIZE, config.VOICE_RETRY_MAX_ATTEMPTS).catch((err) => {
      log.error({ err }, 'voice retry worker: unhandled error in batch run');
    });
  }, config.VOICE_RETRY_INTERVAL_MS);
}

export function stopVoiceRetryWorker(): void {
  if (intervalHandle === null) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  log.info('voice retry worker stopped');
}

async function runRetryBatch(batchSizePerTenant: number, maxAttempts: number): Promise<void> {
  let tenantIds: string[];
  try {
    tenantIds = await listDistinctTenantsWithFailedEvents();
  } catch (err) {
    log.error({ err }, 'voice retry worker: failed to query tenant list from DB');
    return;
  }

  if (tenantIds.length === 0) {
    log.debug('voice retry worker: no tenants with failed events');
    return;
  }

  log.info({ tenantCount: tenantIds.length }, 'voice retry worker: tenants with failed events found, starting batch');

  for (const tenantId of tenantIds) {
    let events;
    try {
      events = await listFailedEvents(tenantId, batchSizePerTenant);
    } catch (err) {
      log.error({ tenantId, err }, 'voice retry worker: failed to list failed events for tenant');
      continue;
    }

    for (const event of events) {
      // Dead-letter check: move to terminal state instead of retrying
      if (event.retry_count >= maxAttempts) {
        try {
          await markEventDeadLetter(tenantId, event.id);
          log.warn(
            { eventId: event.id, tenantId, eventType: event.event_type, retryCount: event.retry_count, maxAttempts },
            'voice retry worker: max retries exceeded, event moved to dead_letter',
          );
        } catch (err) {
          log.error({ eventId: event.id, tenantId, err }, 'voice retry worker: failed to mark event as dead_letter');
        }
        continue;
      }

      // Increment counter before the attempt so we never under-count on crash
      try {
        await incrementRetryCount(tenantId, event.id);
      } catch (err) {
        log.error({ eventId: event.id, tenantId, err }, 'voice retry worker: failed to increment retry count, skipping event');
        continue;
      }

      try {
        await replayFailedEvent(tenantId, event.id);
        // replayFailedEvent logs retry-requested + processed/failed internally
      } catch {
        // processing error already logged at error level by dispatchAndSettle;
        // log at warn here so the worker's own batch perspective is traceable
        log.warn(
          { eventId: event.id, tenantId, eventType: event.event_type, retryCount: event.retry_count + 1 },
          'voice retry worker: retry attempt failed, continuing to next event',
        );
      }
    }
  }
}
