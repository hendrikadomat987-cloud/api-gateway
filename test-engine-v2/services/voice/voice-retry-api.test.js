'use strict';

/**
 * Voice — Manual Retry API Tests
 *
 * Tests the POST /voice/events/:id/retry endpoint.
 *
 * Always-run (no DB required):
 *   1. Retry non-existent event → 404 VOICE_EVENT_NOT_FOUND
 *   2. Retry a 'processed' event → 409 VOICE_EVENT_NOT_RETRYABLE
 *
 * DB-dependent (requires VOICE_TEST_DB_URL in .env):
 *   3. Retry a 'failed' event → 200 and event transitions to 'processed'
 *
 * For test 3, VOICE_TEST_DB_URL must point to the running application database
 * using a superuser connection that can bypass RLS. The test forces an event to
 * 'failed' via a direct UPDATE, then triggers the retry via the API and confirms
 * the event status transitions to 'processed'.
 */

const config  = require('../../config/config');

const {
  sendVoiceWebhook,
  listVoiceCalls,
  getVoiceCallEvents,
  retryVoiceEvent,
} = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  uniqueVoiceCallId,
} = require('../../core/factories');

const {
  expectSuccess,
  expectError,
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

/** Fake but valid-format UUID — guaranteed not to exist in the DB. */
const NONEXISTENT_EVENT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Send a status-update webhook and return the internal call ID.
 *
 * @param {string} providerCallId
 * @returns {Promise<string>} internal voice_calls.id UUID
 */
async function seedCall(providerCallId) {
  const res = await sendVoiceWebhook(buildVapiStatusUpdate(providerCallId));
  if (res.status >= 300) {
    throw new Error(`seedCall: webhook rejected with ${res.status}: ${JSON.stringify(res.data)}`);
  }

  const list = await listVoiceCalls(TOKEN);
  if (list.status !== 200 || !list.data?.success) {
    throw new Error(`seedCall: GET /voice/calls failed: ${JSON.stringify(list.data)}`);
  }
  const call = list.data.data.find((c) => c.provider_call_id === providerCallId);
  if (!call) throw new Error(`seedCall: call ${providerCallId} not found after webhook`);
  return call.id;
}

/**
 * Get the first event of the given type for a call.
 *
 * @param {string} callId
 * @param {string} eventType - e.g. 'call.status_update'
 * @returns {Promise<object>}
 */
async function getEventByType(callId, eventType) {
  const res    = await getVoiceCallEvents(TOKEN, callId);
  const events = expectSuccess(res);
  return assertEventExists(events, eventType);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / retry-api', () => {
  // ── Case 1: Non-existent event ─────────────────────────────────────────────

  it('retry non-existent event → 404 VOICE_EVENT_NOT_FOUND', async () => {
    const res = await retryVoiceEvent(TOKEN, NONEXISTENT_EVENT_ID);
    expectError(res, 404, 'VOICE_EVENT_NOT_FOUND');
  });

  // ── Case 2: Already-processed event ───────────────────────────────────────

  describe('retry already-processed event', () => {
    let callId;
    let eventId;

    beforeAll(async () => {
      const providerCallId = uniqueVoiceCallId('test-retry-api-409');
      callId  = await seedCall(providerCallId);
      const event = await getEventByType(callId, 'call.status_update');
      eventId = event.id;
    });

    it('retry processed event → 409 VOICE_EVENT_NOT_RETRYABLE', async () => {
      expect(eventId).toBeDefined();
      const res = await retryVoiceEvent(TOKEN, eventId);
      expectError(res, 409, 'VOICE_EVENT_NOT_RETRYABLE');
    });
  });

  // ── Case 3: Failed event — happy path (DB required) ───────────────────────

  describe('retry failed event (requires VOICE_TEST_DB_URL)', () => {
    let dbClient;
    let callId;
    let eventId;

    beforeAll(async () => {
      if (!isDbConfigured()) return;   // skip setup when DB is unavailable

      const providerCallId = uniqueVoiceCallId('test-retry-api-200');
      callId  = await seedCall(providerCallId);
      const event = await getEventByType(callId, 'call.status_update');
      eventId = event.id;

      dbClient = await createClient();
      await forceEventStatus(dbClient, eventId, 'failed');
    });

    afterAll(async () => {
      if (dbClient) await releaseClient(dbClient);
    });

    it('retry failed event → 200 success', async () => {
      if (!isDbConfigured()) {
        console.log('  [SKIP] VOICE_TEST_DB_URL not configured — skipping DB-dependent retry test');
        return;
      }

      expect(eventId).toBeDefined();
      const res = await retryVoiceEvent(TOKEN, eventId);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
    });

    it('after retry, event status transitions to processed', async () => {
      if (!isDbConfigured()) {
        console.log('  [SKIP] VOICE_TEST_DB_URL not configured — skipping DB-dependent retry test');
        return;
      }

      expect(callId).toBeDefined();
      expect(eventId).toBeDefined();

      const res    = await getVoiceCallEvents(TOKEN, callId);
      const events = expectSuccess(res);
      const event  = events.find((e) => e.id === eventId);

      if (!event) {
        throw new Error(`Event ${eventId} not found in call events after retry`);
      }

      assertEventProcessingStatus(event, 'processed');
    });
  });

  // ── Case 4: Dead-letter event — manual retry is allowed (DB required) ─────

  describe('retry dead_letter event (requires VOICE_TEST_DB_URL)', () => {
    let dbClient;
    let callId;
    let eventId;

    beforeAll(async () => {
      if (!isDbConfigured()) return;

      const providerCallId = uniqueVoiceCallId('test-retry-api-dead-letter');
      callId  = await seedCall(providerCallId);
      const event = await getEventByType(callId, 'call.status_update');
      eventId = event.id;

      dbClient = await createClient();
      // Simulate an event that exhausted auto-retries
      await forceEventStatus(dbClient, eventId, 'dead_letter');
    });

    afterAll(async () => {
      if (dbClient) await releaseClient(dbClient);
    });

    it('retry dead_letter event → 200 (operator override allowed)', async () => {
      if (!isDbConfigured()) {
        console.log('  [SKIP] VOICE_TEST_DB_URL not configured — skipping dead-letter manual retry test');
        return;
      }

      expect(eventId).toBeDefined();
      const res = await retryVoiceEvent(TOKEN, eventId);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
    });

    it('after manual retry of dead_letter, event transitions to processed', async () => {
      if (!isDbConfigured()) {
        console.log('  [SKIP] VOICE_TEST_DB_URL not configured — skipping dead-letter manual retry test');
        return;
      }

      const res    = await getVoiceCallEvents(TOKEN, callId);
      const events = expectSuccess(res);
      const event  = events.find((e) => e.id === eventId);

      if (!event) throw new Error(`Event ${eventId} not found in call events after dead_letter retry`);

      assertEventProcessingStatus(event, 'processed');
    });
  });
});
