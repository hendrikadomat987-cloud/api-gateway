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
  // Legacy
  assertStatus,
  assertSuccess,
  assertError,
  assertSchema,
  assertField,
  fail: _fail,
};
