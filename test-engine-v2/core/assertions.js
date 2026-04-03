'use strict';

/**
 * Assertion helpers for the API test engine.
 *
 * Two flavours are exported:
 *
 *  1. Jest-native helpers  (expectSuccess, expectError, …)
 *     Use these in the new services/ and scenarios/ tests.
 *     They call Jest's `expect()` internally — errors appear in Jest output.
 *
 *  2. Legacy throw-based helpers  (assertStatus, assertSuccess, …)
 *     Kept for backward-compatibility with the old tests/ directory.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Jest-native helpers
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Assert a successful API response.
 * Returns `response.data.data` for convenience.
 *
 * @param {import('axios').AxiosResponse} res
 * @param {number} [status=200]
 * @returns {any} response.data.data
 */
function expectSuccess(res, status = 200) {
  expect(res.status).toBe(status);
  expect(res.data).toBeDefined();
  expect(res.data.success).toBe(true);
  expect(res.data.data).toBeDefined();
  return res.data.data;
}

/**
 * Assert a well-formed error response.
 *
 * @param {import('axios').AxiosResponse} res
 * @param {number}  expectedStatus
 * @param {string}  expectedCode  - e.g. 'VALIDATION_ERROR'
 * @param {string}  [msgSubstr]   - optional substring in error.message
 */
function expectError(res, expectedStatus, expectedCode, msgSubstr) {
  expect(res.status).toBe(expectedStatus);
  expect(res.data).toBeDefined();
  expect(res.data.success).toBe(false);
  expect(res.data.error).toBeDefined();
  expect(res.data.error.code).toBe(expectedCode);
  if (msgSubstr) {
    expect(res.data.error.message).toContain(msgSubstr);
  }
}

/** Assert 400 VALIDATION_ERROR */
function expectValidationError(res, msgSubstr) {
  expectError(res, 400, 'VALIDATION_ERROR', msgSubstr);
}

/** Assert 401 (any 401 error code) */
function expectUnauthorized(res) {
  expect(res.status).toBe(401);
  expect(res.data.success).toBe(false);
}

/** Assert 403 */
function expectForbidden(res) {
  expect(res.status).toBe(403);
  expect(res.data.success).toBe(false);
}

/** Assert 400 INVALID_ID */
function expectInvalidId(res) {
  expectError(res, 400, 'INVALID_ID');
}

/**
 * Assert cross-tenant isolation.
 * Throws (fails the test) if the response leaks data.
 *
 * @param {import('axios').AxiosResponse} res
 * @param {string} resourceId - for the error message
 */
function expectNoDataLeak(res, resourceId) {
  const leaked = res.status === 200 && res.data?.success === true && res.data?.data?.id;
  if (leaked) {
    throw new Error(
      `DATA LEAK: cross-tenant response contains resource ${resourceId}.\n` +
      `Status: ${res.status}\nBody: ${JSON.stringify(res.data)}`
    );
  }
}

/**
 * Assert a value looks like a UUID v4.
 * @param {string} id
 */
function expectUuid(id) {
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
}

// ═════════════════════════════════════════════════════════════════════════════
// Legacy throw-based helpers (backward compatibility)
// ═════════════════════════════════════════════════════════════════════════════

function _fail(message, context = {}) {
  const extra = Object.keys(context).length
    ? '\n  ' + JSON.stringify(context, null, 2).replace(/\n/g, '\n  ')
    : '';
  const err = new Error(`Assertion failed: ${message}${extra}`);
  err.name = 'AssertionError';
  throw err;
}

function assertStatus(response, expected) {
  if (response.status !== expected) {
    _fail(`Expected status ${expected} but got ${response.status}`, { body: response.data });
  }
}

function assertSuccess(response) {
  if (!response.data || response.data.success !== true) {
    _fail('Expected { success: true } in response body', { body: response.data });
  }
}

function assertError(response, expectedCode, messageSubstr) {
  if (!response.data || response.data.success !== false) {
    _fail('Expected { success: false } in error response', { body: response.data });
  }
  const err = response.data.error;
  if (!err) _fail('Missing error object in response body', { body: response.data });
  if (err.code !== expectedCode) {
    _fail(`Expected error code "${expectedCode}" but got "${err.code}"`, { body: response.data });
  }
  if (messageSubstr && !(err.message || '').includes(messageSubstr)) {
    _fail(`Expected error.message to contain "${messageSubstr}"`, { actualMessage: err.message });
  }
}

function assertSchema(response, requiredFields) {
  const data = response.data && response.data.data;
  if (!data) _fail('Expected response.data.data to be present', { body: response.data });
  for (const field of requiredFields) {
    if (!(field in data)) {
      _fail(`Missing required field "${field}" in response.data.data`, { presentFields: Object.keys(data) });
    }
  }
}

function assertField(response, field, expected) {
  const data = response.data && response.data.data;
  if (!data) _fail('Expected response.data.data to be present', { body: response.data });
  if (data[field] !== expected) {
    _fail(`Expected field "${field}" to be "${expected}" but got "${data[field]}"`, {
      field, expected, actual: data[field],
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Calculation / Engine Logic helpers  (availability-engine)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Assert a free-slots response contains a non-empty array of slot objects.
 *
 * @param {import('axios').AxiosResponse} res
 * @returns {any[]} the slots array
 */
function expectFreeSlotsArray(res) {
  expect(res.status).toBe(200);
  expect(res.data.success).toBe(true);
  const slots = res.data.data;
  expect(Array.isArray(slots)).toBe(true);
  expect(slots.length).toBeGreaterThan(0);
  return slots;
}

/**
 * Assert a single slot window has the expected shape:
 * `{ start: ISO-string, end: ISO-string }` with start < end.
 *
 * @param {object} slot
 */
function expectSlotWindow(slot) {
  expect(slot).toBeDefined();
  expect(typeof slot.start).toBe('string');
  expect(typeof slot.end).toBe('string');
  expect(new Date(slot.start).getTime()).toBeLessThan(new Date(slot.end).getTime());
}

/**
 * Assert a slot-check response indicates the slot IS bookable.
 *
 * @param {import('axios').AxiosResponse} res
 */
function expectBookableTrue(res) {
  expect(res.status).toBe(200);
  expect(res.data.success).toBe(true);
  expect(res.data.data.bookable).toBe(true);
}

/**
 * Assert a slot-check response indicates the slot is NOT bookable
 * and includes a non-empty reason string.
 *
 * @param {import('axios').AxiosResponse} res
 * @param {string} [reasonSubstr] - optional substring expected in reason
 */
function expectBookableFalseWithReason(res, reasonSubstr) {
  expect(res.status).toBe(200);
  expect(res.data.success).toBe(true);
  expect(res.data.data.bookable).toBe(false);
  expect(typeof res.data.data.reason).toBe('string');
  expect(res.data.data.reason.length).toBeGreaterThan(0);
  if (reasonSubstr) {
    expect(res.data.data.reason).toContain(reasonSubstr);
  }
}

/**
 * Assert that no two slots in the array overlap.
 * Slots are compared after sorting by start time.
 *
 * @param {Array<{start:string, end:string}>} slots
 */
function expectNoSlotOverlap(slots) {
  expect(Array.isArray(slots)).toBe(true);
  const sorted = [...slots].sort((a, b) => new Date(a.start) - new Date(b.start));
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd   = new Date(sorted[i - 1].end).getTime();
    const currStart = new Date(sorted[i].start).getTime();
    expect(currStart).toBeGreaterThanOrEqual(prevEnd);
  }
}

/**
 * Assert a day-view response has the expected top-level shape:
 * `{ working_windows: [], busy_windows: [], free_slots: [] }`.
 *
 * @param {import('axios').AxiosResponse} res
 * @returns {object} the day-view data object
 */
function expectDayViewShape(res) {
  expect(res.status).toBe(200);
  expect(res.data.success).toBe(true);
  const data = res.data.data;
  expect(data).toBeDefined();
  expect(Array.isArray(data.working_windows)).toBe(true);
  expect(Array.isArray(data.busy_windows)).toBe(true);
  expect(Array.isArray(data.free_slots)).toBe(true);
  return data;
}

// ═════════════════════════════════════════════════════════════════════════════
// Voice helpers
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Assert a voice call has status=completed and the required summary fields.
 * Field names match the voice_calls DB schema (snake_case, returned as-is).
 *
 * @param {object} call - response.data.data from getVoiceCall
 */
function assertVoiceCallCompleted(call) {
  expect(call).toBeDefined();
  expect(call.status).toBe('completed');
  // duration_seconds is the DB column name (integer, nullable until end-of-call-report)
  expect(call.duration_seconds).toBeDefined();
  expect(typeof call.duration_seconds).toBe('number');
  expect(call.summary).toBeDefined();
  expect(call.summary.length).toBeGreaterThan(0);
}

/**
 * Assert an event of the given type exists in the events array.
 * Returns the first matching event.
 *
 * @param {object[]} events
 * @param {string}   type  - e.g. 'end-of-call-report'
 * @returns {object} the matched event
 */
function assertEventExists(events, type) {
  expect(Array.isArray(events)).toBe(true);
  const found = events.find((e) => e.event_type === type);
  if (!found) {
    throw new Error(
      `Expected event of type "${type}" but found none.\n` +
      `Events: ${JSON.stringify(events.map((e) => e.event_type))}`
    );
  }
  return found;
}

/**
 * Assert exactly one event of the given type exists (idempotency check).
 *
 * @param {object[]} events
 * @param {string}   type
 * @returns {object} the single matching event
 */
function assertSingleEvent(events, type) {
  expect(Array.isArray(events)).toBe(true);
  const matching = events.filter((e) => e.event_type === type);
  if (matching.length !== 1) {
    throw new Error(
      `Expected exactly 1 event of type "${type}" but found ${matching.length}.\n` +
      `All events: ${JSON.stringify(events.map((e) => e.event_type))}`
    );
  }
  return matching[0];
}

/**
 * Assert an event has valid timestamp fields.
 *
 * event_ts is nullable in the schema (provider timestamp — may not be set for
 * all event types). When present it must be a valid ISO string.
 * created_at (persistence time) is always present and always valid.
 *
 * @param {object} event
 */
function assertEventTimestamp(event) {
  expect(event).toBeDefined();

  // created_at is NOT NULL in the schema — always check it
  expect(event.created_at).toBeDefined();
  const cat = new Date(event.created_at).getTime();
  if (Number.isNaN(cat)) {
    throw new Error(`created_at "${event.created_at}" is not a valid ISO timestamp.`);
  }

  // event_ts is nullable (TIMESTAMPTZ NULL) — only validate when present
  if (event.event_ts != null) {
    const ets = new Date(event.event_ts).getTime();
    if (Number.isNaN(ets)) {
      throw new Error(`event_ts "${event.event_ts}" is not a valid ISO timestamp.`);
    }
  }
}

/**
 * Assert an event has the expected processing_status value.
 *
 * @param {object} event          - a voice_events row (from getVoiceCallEvents)
 * @param {string} expectedStatus - 'received' | 'processed' | 'failed'
 */
function assertEventProcessingStatus(event, expectedStatus) {
  expect(event).toBeDefined();
  expect(event.processing_status).toBe(expectedStatus);
}

/**
 * Assert cross-tenant isolation — the response must NOT contain voice data.
 * Accepts 404, empty data, or a well-formed empty list.
 *
 * @param {import('axios').AxiosResponse} res
 * @param {string} [callId] - for the error message
 */
function assertTenantIsolationFailure(res, callId) {
  const hasData =
    res.status === 200 &&
    res.data?.success === true &&
    res.data?.data != null &&
    (Array.isArray(res.data.data) ? res.data.data.length > 0 : true);

  if (hasData) {
    throw new Error(
      `DATA LEAK: Tenant B can see voice data` +
      (callId ? ` for call "${callId}"` : '') +
      `.\nStatus: ${res.status}\nBody: ${JSON.stringify(res.data)}`
    );
  }
}

module.exports = {
  // Jest-native
  expectSuccess,
  expectError,
  expectValidationError,
  expectUnauthorized,
  expectForbidden,
  expectInvalidId,
  expectNoDataLeak,
  expectUuid,
  // Calculation / Engine Logic
  expectFreeSlotsArray,
  expectSlotWindow,
  expectBookableTrue,
  expectBookableFalseWithReason,
  expectNoSlotOverlap,
  expectDayViewShape,
  // Voice
  assertVoiceCallCompleted,
  assertEventExists,
  assertSingleEvent,
  assertEventTimestamp,
  assertEventProcessingStatus,
  assertTenantIsolationFailure,
  // Legacy
  assertStatus,
  assertSuccess,
  assertError,
  assertSchema,
  assertField,
  fail: _fail,
};
