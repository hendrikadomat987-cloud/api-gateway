'use strict';

/**
 * fixtureLoader — load and patch live webhook fixtures for replay tests.
 *
 * Fixtures live in: fixtures/voice/live/*.json
 *
 * Each fixture is a deep-cloned object on load so callers can mutate freely.
 * Placeholder fields (e.g. "REPLACE_WITH_REAL_CALL_ID") are documented inside
 * each fixture file and can be overwritten via patchCallId / patchAssistantId
 * or the generic loadFixtureWithOverrides helper.
 */

const fs   = require('node:fs');
const path = require('node:path');

const FIXTURE_BASE      = path.join(__dirname, '..', 'fixtures', 'voice', 'live');
const REAL_FIXTURE_BASE = path.join(FIXTURE_BASE, 'real');

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a JSON fixture by filename from fixtures/voice/live/.
 * Returns a deep clone — safe to mutate.
 *
 * @param {string} name  - e.g. 'vapi-status-update.json'
 * @returns {object}
 * @throws if the file is missing or contains invalid JSON
 */
function loadFixture(name) {
  const filePath = path.join(FIXTURE_BASE, name);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[fixtureLoader] Fixture not found: "${name}"\n` +
      `  Expected path: ${filePath}\n` +
      `  To add a real Vapi payload: copy the raw webhook body into fixtures/voice/live/${name}`,
    );
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`[fixtureLoader] Cannot read fixture "${name}": ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[fixtureLoader] Invalid JSON in fixture "${name}": ${err.message}\n` +
      `  Check for trailing commas or unquoted keys.`,
    );
  }

  // Strip internal _fixture_meta before returning — it is not part of the payload
  const clone = JSON.parse(JSON.stringify(parsed));
  delete clone._fixture_meta;
  return clone;
}

/**
 * Load a fixture and shallow-merge overrides into the object at `targetPath`.
 * Default target is "message" (the top-level envelope field in all Vapi webhooks).
 *
 * Example:
 *   loadFixtureWithOverrides('vapi-status-update.json', { status: 'ended' })
 *   → merges { status: 'ended' } into fixture.message
 *
 * @param {string} name        - fixture filename
 * @param {object} [overrides] - key/value pairs to shallow-merge at targetPath
 * @param {string} [targetPath] - dot-notation path inside the fixture (default: 'message')
 * @returns {object}
 */
function loadFixtureWithOverrides(name, overrides = {}, targetPath = 'message') {
  const fixture = loadFixture(name);

  if (!overrides || Object.keys(overrides).length === 0) return fixture;

  const keys   = targetPath.split('.');
  let   target = fixture;

  for (const key of keys) {
    if (target == null || typeof target !== 'object') {
      throw new Error(
        `[fixtureLoader] Path "${targetPath}" not reachable in fixture "${name}" — ` +
        `segment "${key}" is null or not an object.`,
      );
    }
    target = target[key];
  }

  if (target == null || typeof target !== 'object') {
    throw new Error(
      `[fixtureLoader] Target at path "${targetPath}" is not an object in fixture "${name}".`,
    );
  }

  Object.assign(target, overrides);
  return fixture;
}

/**
 * Patch message.call.id in a loaded fixture.
 * This is the provider_call_id used to correlate the webhook with a voice_calls row.
 *
 * @param {object} fixture  - already-loaded fixture (mutated in place)
 * @param {string} callId   - new call ID to inject
 * @returns {object}        - same fixture reference
 */
function patchCallId(fixture, callId) {
  if (fixture?.message?.call) {
    fixture.message.call.id = callId;
  }
  return fixture;
}

/**
 * Patch message.call.assistantId in a loaded fixture.
 * Required for tenant resolution when the phone number is not registered.
 *
 * @param {object} fixture      - already-loaded fixture (mutated in place)
 * @param {string} assistantId  - new assistant ID to inject
 * @returns {object}
 */
function patchAssistantId(fixture, assistantId) {
  if (fixture?.message?.call) {
    fixture.message.call.assistantId = assistantId;
  }
  return fixture;
}

/**
 * List all .json fixture filenames available in fixtures/voice/live/.
 * Returns an empty array if the directory does not exist or cannot be read.
 *
 * @returns {string[]}
 */
function listFixtures() {
  try {
    return fs.readdirSync(FIXTURE_BASE).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}

/**
 * Returns true if a given fixture file exists on disk (placeholder directory).
 *
 * @param {string} name  - e.g. 'vapi-status-update.json'
 * @returns {boolean}
 */
function fixtureExists(name) {
  return fs.existsSync(path.join(FIXTURE_BASE, name));
}

// ─────────────────────────────────────────────────────────────────────────────
// Real-fixture support (fixtures/voice/live/real/)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if a real (non-placeholder) fixture exists in fixtures/voice/live/real/.
 *
 * @param {string} name  - e.g. 'vapi-status-update.json'
 * @returns {boolean}
 */
function realFixtureExists(name) {
  return fs.existsSync(path.join(REAL_FIXTURE_BASE, name));
}

/**
 * List all .json filenames available in fixtures/voice/live/real/.
 * Returns an empty array if the directory does not exist or is empty.
 *
 * @returns {string[]}
 */
function listRealFixtures() {
  try {
    return fs.readdirSync(REAL_FIXTURE_BASE).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}

/**
 * Load a fixture, preferring the real/ subdirectory over the placeholder.
 *
 * Lookup order:
 *   1. fixtures/voice/live/real/<name>  → source: 'real'
 *   2. fixtures/voice/live/<name>       → source: 'placeholder'
 *
 * Returns a deep clone — safe to mutate.
 * The `_fixture_meta` key is stripped from both sources before returning.
 *
 * @param {string} name - fixture filename, e.g. 'vapi-status-update.json'
 * @returns {{ fixture: object, source: 'real'|'placeholder' }}
 * @throws if neither real nor placeholder file can be loaded
 */
function loadFixtureWithFallback(name) {
  if (realFixtureExists(name)) {
    const filePath = path.join(REAL_FIXTURE_BASE, name);

    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`[fixtureLoader] Cannot read real fixture "${name}": ${err.message}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `[fixtureLoader] Invalid JSON in real fixture "${name}": ${err.message}\n` +
        `  File: ${filePath}`,
      );
    }

    const clone = JSON.parse(JSON.stringify(parsed));
    delete clone._fixture_meta;
    return { fixture: clone, source: 'real' };
  }

  // Fallback: load placeholder from fixtures/voice/live/
  return { fixture: loadFixture(name), source: 'placeholder' };
}

module.exports = {
  loadFixture,
  loadFixtureWithOverrides,
  loadFixtureWithFallback,
  patchCallId,
  patchAssistantId,
  listFixtures,
  fixtureExists,
  realFixtureExists,
  listRealFixtures,
  /** Absolute path to the placeholder fixture directory. */
  FIXTURE_BASE,
  /** Absolute path to the real fixture directory (fixtures/voice/live/real/). */
  REAL_FIXTURE_BASE,
};
