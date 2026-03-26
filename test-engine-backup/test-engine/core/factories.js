'use strict';

/**
 * Test data factories.
 *
 * Each factory returns a fresh, unique payload on every call.
 * Uniqueness is guaranteed by combining a timestamp with an auto-increment
 * counter — safe for parallel execution within a single process.
 */

let _seq = 0;
const seq = () => String(++_seq).padStart(6, '0');

// ── Customer ──────────────────────────────────────────────────────────────────

/**
 * @param {Partial<{name:string, email:string, phone:string}>} [overrides]
 */
function customerFactory(overrides = {}) {
  const n = seq();
  return {
    name:  `Test Customer ${n}`,
    email: `test.customer.${n}.${Date.now()}@example.com`,
    phone: `+490000${n}`,
    ...overrides,
  };
}

// ── Request ───────────────────────────────────────────────────────────────────

const REQUEST_TYPES    = ['callback', 'support', 'quote', 'info'];
const REQUEST_STATUSES = ['pending', 'in_progress', 'resolved', 'closed'];

/**
 * @param {string} customerId  - Required — the owning customer's ID
 * @param {Partial<{type:string, status:string, notes:string}>} [overrides]
 */
function requestFactory(customerId, overrides = {}) {
  if (!customerId) throw new Error('requestFactory: customerId is required');
  return {
    customer_id: customerId,
    type:        'support',
    status:      'pending',
    notes:       `Test request ${seq()} – ${Date.now()}`,
    ...overrides,
  };
}

// ── Resource ──────────────────────────────────────────────────────────────────

const RESOURCE_TYPES    = ['document', 'template', 'script', 'faq'];
const RESOURCE_STATUSES = ['active', 'draft', 'archived'];

/**
 * @param {Partial<{name:string, type:string, content:string, status:string}>} [overrides]
 */
function resourceFactory(overrides = {}) {
  const n = seq();
  return {
    name:    `Test Resource ${n}`,
    type:    'document',
    content: `Content body for resource ${n} – ${Date.now()}`,
    status:  'active',
    ...overrides,
  };
}

module.exports = {
  customerFactory,
  requestFactory,
  resourceFactory,
  REQUEST_TYPES,
  REQUEST_STATUSES,
  RESOURCE_TYPES,
  RESOURCE_STATUSES,
};
