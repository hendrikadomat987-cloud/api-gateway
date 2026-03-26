'use strict';

/**
 * TestContext
 *
 * A lightweight per-test-file state container.
 *
 * Responsibilities:
 *  - store arbitrary key/value data (e.g. created IDs, tokens)
 *  - track created resource IDs for cleanup
 *
 * Usage:
 *   const ctx = new TestContext();
 *   ctx.register('customers', customerId);
 *   ctx.set('primaryCustomerId', customerId);
 *   ctx.get('primaryCustomerId');           // → the ID
 *   ctx.getIds('customers');               // → [customerId]
 *   ctx.all();                             // → { customers: [...] }
 */
class TestContext {
  constructor() {
    /** @type {Record<string, string[]>} resource buckets for cleanup */
    this._resources = {};
    /** @type {Record<string, any>} arbitrary key/value store */
    this._store = {};
  }

  /**
   * Register a resource ID for cleanup.
   * @param {'customers'|'requests'|'resources'|string} type
   * @param {string} id
   * @returns {string} the id (for chaining: ctx.set('x', ctx.register(...)))
   */
  register(type, id) {
    if (!id) return id;
    if (!this._resources[type]) this._resources[type] = [];
    if (!this._resources[type].includes(id)) {
      this._resources[type].push(id);
    }
    return id;
  }

  /**
   * Retrieve all registered IDs for a resource type.
   * @param {string} type
   * @returns {string[]}
   */
  getIds(type) {
    return this._resources[type] ? [...this._resources[type]] : [];
  }

  /**
   * Store an arbitrary value.
   * @param {string} key
   * @param {any}    value
   * @returns {any} the value (for chaining)
   */
  set(key, value) {
    this._store[key] = value;
    return value;
  }

  /**
   * Retrieve a stored value.
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    return this._store[key];
  }

  /**
   * All registered resource buckets (snapshot).
   * @returns {Record<string, string[]>}
   */
  all() {
    const out = {};
    for (const [type, ids] of Object.entries(this._resources)) {
      out[type] = [...ids];
    }
    return out;
  }

  /**
   * Reset all state — resources and key/value store.
   * Useful when reusing a context across multiple test phases.
   */
  reset() {
    this._resources = {};
    this._store     = {};
  }

  /**
   * Return a human-readable summary of the current context state.
   * Useful for debugging test failures.
   * @returns {string}
   */
  debugInfo() {
    const resources = Object.entries(this._resources)
      .map(([type, ids]) => `  ${type}: [${ids.join(', ')}]`)
      .join('\n') || '  (none)';
    const store = Object.entries(this._store)
      .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
      .join('\n') || '  (empty)';
    return `TestContext\nResources:\n${resources}\nStore:\n${store}`;
  }
}

module.exports = { TestContext };
