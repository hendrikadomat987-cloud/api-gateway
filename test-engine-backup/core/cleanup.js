'use strict';

const { createClient } = require('./apiClient');
const logger           = require('./logger');

// ── Route registry ────────────────────────────────────────────────────────────

/** Maps resource type → DELETE path factory */
const ROUTES = {
  requests:  (id) => `/requests/${id}`,
  resources: (id) => `/resources/${id}`,
  customers: (id) => `/customer/${id}`,   // note: singular endpoint
};

// Delete in reverse FK order so we don't violate constraints
const DELETE_ORDER = ['requests', 'resources', 'customers'];

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _deleteOne(client, type, id) {
  const routeFn = ROUTES[type];
  if (!routeFn) {
    logger.warn(`cleanup: unknown resource type "${type}" — skipping ${id}`);
    return;
  }
  try {
    const res = await client.delete(routeFn(id));
    if (res.status !== 200 && res.status !== 404) {
      logger.warn(`cleanup: unexpected ${res.status} for DELETE ${type}/${id}`);
    } else {
      logger.debug(`cleanup: deleted ${type}/${id} (${res.status})`);
    }
  } catch (err) {
    // Never let cleanup crash a test suite
    logger.warn(`cleanup: network error deleting ${type}/${id} — ${err.message}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Delete all resources tracked in a TestContext.
 * Runs deletions in FK-safe order (requests → resources → customers).
 * Never throws — all errors are logged and swallowed.
 *
 * @param {import('./context').TestContext} ctx
 * @param {object}  [options]
 * @param {object}  [options.client]  - ApiClient to use (defaults to tenantA client)
 */
async function cleanupContext(ctx, { client } = {}) {
  const _client = client || createClient();
  const all     = ctx.all();
  const types   = Object.keys(all);
  const sorted  = [
    ...DELETE_ORDER.filter((t) => types.includes(t)),
    ...types.filter((t) => !DELETE_ORDER.includes(t)),
  ];

  for (const type of sorted) {
    for (const id of all[type]) {
      await _deleteOne(_client, type, id);
    }
  }
}

/**
 * Delete a single resource by type and ID.
 * Never throws.
 *
 * @param {'customers'|'requests'|'resources'|string} type
 * @param {string} id
 * @param {object} [options]
 * @param {object} [options.client] - ApiClient to use (defaults to tenantA client)
 */
async function deleteOne(type, id, { client } = {}) {
  const _client = client || createClient();
  await _deleteOne(_client, type, id);
}

module.exports = { cleanupContext, deleteOne };
