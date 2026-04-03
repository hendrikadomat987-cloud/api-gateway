'use strict';

/**
 * Voice — Automatic Retry Worker Tests
 *
 * Verifies that the background retry worker picks up failed events and
 * re-processes them without manual intervention.
 *
 * All tests in this file require VOICE_TEST_DB_URL (see voice-db.js).
 * When not set, all tests skip cleanly.
 *
 * Backend configuration required:
 *   VOICE_RETRY_ENABLED=true
 *   VOICE_RETRY_INTERVAL_MS=5000   (short interval so tests don't time out)
 *   VOICE_RETRY_BATCH_SIZE=10      (default is fine)
 *
 * Strategy:
 *   1. Send a webhook → creates a call + event (status: processed)
 *   2. Force event to status='failed' via direct DB UPDATE (VOICE_TEST_DB_URL)
 *   3. Poll GET /voice/calls/:id/events until the target event is 'processed' again
 *      or the poll timeout expires (default: 30 s)
 *   4. Assert the final status is 'processed'
 *
 * The poll timeout must exceed VOICE_RETRY_INTERVAL_MS configured on the backend.
 * Default poll timeout here is 30 s — ensure the backend interval is well below that.
 */

const config = require('../../config/config');

const {
  sendVoiceWebhook,
  listVoiceCalls,
  getVoiceCallEvents,
} = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  uniqueVoiceCallId,
} = require('../../core/factories');

const {
  expectSuccess,
  assertEventExists,
  assertEventProcessingStatus,
} = require('../../core/assertions');

const {
  isDbConfigured,
  createClient,
  releaseClient,
  forceEventStatus,
} = require('./voice-db');

// ─────────────────────────────────────────────────────────────────────────────

const TOKEN = config.tokens.tenantA;

/** How long to poll for the worker to pick up the failed event (ms). */
const WORKER_POLL_TIMEOUT_MS  = 30_000;
/** Polling interval (ms) — keep this well below WORKER_POLL_TIMEOUT_MS. */
const WORKER_POLL_INTERVAL_MS = 1_500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll a predicate until it returns true or the timeout is exceeded.
 *
 * @param {() => Promise<boolean>} predicate
 * @param {number} timeoutMs
 * @param {number} intervalMs
 * @returns {Promise<boolean>} true if predicate returned true, false on timeout
 */
async function pollUntil(predicate, timeoutMs = WORKER_POLL_TIMEOUT_MS, intervalMs = WORKER_POLL_INTERVAL_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

/**
 * Send a status-update webhook and return { callId, eventId }.
 *
 * @param {string} providerCallId
 * @returns {Promise<{ callId: string, eventId: string }>}
 */
async function seedCallAndEvent(providerCallId) {
  const webhookRes = await sendVoiceWebhook(buildVapiStatusUpdate(providerCallId));
  if (webhookRes.status >= 300) {
    throw new Error(
      `seedCallAndEvent: webhook rejected with ${webhookRes.status}: ${JSON.stringify(webhookRes.data)}`
    );
  }

  const listRes = await listVoiceCalls(TOKEN);
  if (listRes.status !== 200 || !listRes.data?.success) {
    throw new Error(`seedCallAndEvent: GET /voice/calls failed: ${JSON.stringify(listRes.data)}`);
  }

  const call = listRes.data.data.find((c) => c.provider_call_id === providerCallId);
  if (!call) throw new Error(`seedCallAndEvent: call ${providerCallId} not in list after webhook`);

  const eventsRes = await getVoiceCallEvents(TOKEN, call.id);
  const events    = expectSuccess(eventsRes);
  const event     = assertEventExists(events, 'call.status_update');

  return { callId: call.id, eventId: event.id };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / retry-worker', () => {
  let dbClient;

  beforeAll(async () => {
    if (!isDbConfigured()) return;
    dbClient = await createClient();
  });

  afterAll(async () => {
    if (dbClient) await releaseClient(dbClient);
  });

  // ── Worker picks up a single failed event ─────────────────────────────────

  it('worker automatically retries a failed event within poll timeout', async () => {
    if (!isDbConfigured()) {
      console.log('  [SKIP] VOICE_TEST_DB_URL not configured — skipping worker test');
      return;
    }

    const providerCallId = uniqueVoiceCallId('test-retry-worker');
    const { callId, eventId } = await seedCallAndEvent(providerCallId);

    // Force to failed via DB — worker should detect and retry it
    await forceEventStatus(dbClient, eventId, 'failed');

    // Poll until the event is back to 'processed' or we time out
    const resolved = await pollUntil(async () => {
      const res    = await getVoiceCallEvents(TOKEN, callId);
      if (res.status !== 200 || !res.data?.success) return false;
      const event  = res.data.data.find((e) => e.id === eventId);
      return event?.processing_status === 'processed';
    });

    if (!resolved) {
      // Fetch actual status for a helpful error message
      const res    = await getVoiceCallEvents(TOKEN, callId);
      const events = res.status === 200 && res.data?.success ? res.data.data : [];
      const event  = events.find((e) => e.id === eventId);
      throw new Error(
        `Worker did not retry event ${eventId} within ${WORKER_POLL_TIMEOUT_MS / 1000}s.\n` +
        `Current status: ${event?.processing_status ?? 'unknown'}\n` +
        `Ensure the backend is running with:\n` +
        `  VOICE_RETRY_ENABLED=true\n` +
        `  VOICE_RETRY_INTERVAL_MS=5000  (or shorter)`
      );
    }

    // Final assertion via assertion helper
    const finalRes    = await getVoiceCallEvents(TOKEN, callId);
    const finalEvents = expectSuccess(finalRes);
    const finalEvent  = finalEvents.find((e) => e.id === eventId);
    assertEventProcessingStatus(finalEvent, 'processed');
  }, WORKER_POLL_TIMEOUT_MS + 10_000);   // jest timeout > poll timeout

  // ── Worker processes multiple failed events in one batch ──────────────────

  it('worker processes multiple failed events in a single batch run', async () => {
    if (!isDbConfigured()) {
      console.log('  [SKIP] VOICE_TEST_DB_URL not configured — skipping worker batch test');
      return;
    }

    const COUNT = 3;
    const seeds = await Promise.all(
      Array.from({ length: COUNT }, (_, i) =>
        seedCallAndEvent(uniqueVoiceCallId(`test-retry-worker-batch-${i}`))
      )
    );

    // Force all events to failed
    await Promise.all(seeds.map(({ eventId }) => forceEventStatus(dbClient, eventId, 'failed')));

    // Poll until all events are 'processed'
    const resolved = await pollUntil(async () => {
      const statuses = await Promise.all(
        seeds.map(async ({ callId, eventId }) => {
          const res = await getVoiceCallEvents(TOKEN, callId);
          if (res.status !== 200 || !res.data?.success) return false;
          const event = res.data.data.find((e) => e.id === eventId);
          return event?.processing_status === 'processed';
        })
      );
      return statuses.every(Boolean);
    });

    if (!resolved) {
      throw new Error(
        `Worker did not process all ${COUNT} failed events within ${WORKER_POLL_TIMEOUT_MS / 1000}s.\n` +
        `Ensure VOICE_RETRY_ENABLED=true and VOICE_RETRY_INTERVAL_MS is set to a short value.`
      );
    }

    // Final assertions
    for (const { callId, eventId } of seeds) {
      const res    = await getVoiceCallEvents(TOKEN, callId);
      const events = expectSuccess(res);
      const event  = events.find((e) => e.id === eventId);
      assertEventProcessingStatus(event, 'processed');
    }
  }, WORKER_POLL_TIMEOUT_MS + 10_000);
});
