'use strict';

/**
 * Throws an AssertionError with a descriptive message.
 */
function fail(message, context = {}) {
  const extra = Object.keys(context).length
    ? '\n  ' + JSON.stringify(context, null, 2).replace(/\n/g, '\n  ')
    : '';
  const err = new Error(`Assertion failed: ${message}${extra}`);
  err.name = 'AssertionError';
  throw err;
}

// ── Status code ──────────────────────────────────────────────────────────────

/**
 * Assert that the response has the expected HTTP status code.
 *
 * @param {import('axios').AxiosResponse} response
 * @param {number} expected
 */
function assertStatus(response, expected) {
  if (response.status !== expected) {
    fail(`Expected status ${expected} but got ${response.status}`, {
      body: response.data,
    });
  }
}

// ── Success shape ────────────────────────────────────────────────────────────

/**
 * Assert that response body contains { success: true }.
 *
 * @param {import('axios').AxiosResponse} response
 */
function assertSuccess(response) {
  if (!response.data || response.data.success !== true) {
    fail('Expected { success: true } in response body', {
      body: response.data,
    });
  }
}

// ── Error shape ──────────────────────────────────────────────────────────────

/**
 * Assert that the response contains a well-formed gateway error.
 *
 * @param {import('axios').AxiosResponse} response
 * @param {string}  expectedCode    - e.g. 'VALIDATION_ERROR'
 * @param {string}  [messageSubstr] - optional substring the error.message must contain
 */
function assertError(response, expectedCode, messageSubstr) {
  if (!response.data || response.data.success !== false) {
    fail('Expected { success: false } in error response', { body: response.data });
  }

  const err = response.data.error;
  if (!err) fail('Missing error object in response body', { body: response.data });

  if (err.code !== expectedCode) {
    fail(`Expected error code "${expectedCode}" but got "${err.code}"`, {
      body: response.data,
    });
  }

  if (messageSubstr && !(err.message || '').includes(messageSubstr)) {
    fail(`Expected error.message to contain "${messageSubstr}"`, {
      actualMessage: err.message,
    });
  }
}

// ── Schema ───────────────────────────────────────────────────────────────────

/**
 * Assert that response.data.data contains all required fields.
 *
 * @param {import('axios').AxiosResponse} response
 * @param {string[]} requiredFields
 */
function assertSchema(response, requiredFields) {
  const data = response.data && response.data.data;
  if (!data) {
    fail('Expected response.data.data to be present', { body: response.data });
  }

  for (const field of requiredFields) {
    if (!(field in data)) {
      fail(`Missing required field "${field}" in response.data.data`, {
        presentFields: Object.keys(data),
      });
    }
  }
}

/**
 * Assert that a specific field in response.data.data equals the expected value.
 *
 * @param {import('axios').AxiosResponse} response
 * @param {string} field
 * @param {*}      expected
 */
function assertField(response, field, expected) {
  const data = response.data && response.data.data;
  if (!data) fail('Expected response.data.data to be present', { body: response.data });

  if (data[field] !== expected) {
    fail(`Expected field "${field}" to be "${expected}" but got "${data[field]}"`, {
      field, expected, actual: data[field],
    });
  }
}

module.exports = { assertStatus, assertSuccess, assertError, assertSchema, assertField, fail };
