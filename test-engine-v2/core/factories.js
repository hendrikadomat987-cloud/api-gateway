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

// ── Appointment ───────────────────────────────────────────────────────────────

const APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'cancelled', 'completed'];

/**
 * @param {string} customerId  - Required — the owning customer's ID
 * @param {Partial<{scheduled_at:string, duration_minutes:number, status:string, notes:string}>} [overrides]
 */
function appointmentFactory(customerId, overrides = {}) {
  if (!customerId) throw new Error('appointmentFactory: customerId is required');
  return {
    customer_id:      customerId,
    scheduled_at:     new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    duration_minutes: 30,
    status:           'scheduled',
    notes:            `Test appointment ${seq()} – ${Date.now()}`,
    ...overrides,
  };
}

// ── Availability Engine / Calculation ─────────────────────────────────────────
//
// These factories produce payloads for the future availability-engine service.
// They mirror the expected API contract but do NOT assume the service exists yet.
// All IDs are left to the caller via `overrides`; no hardcoded tenant or resource IDs.

/**
 * Working-hours entry for a resource/calendar (a single day-of-week window).
 *
 * @param {Partial<{day_of_week:number, start_time:string, end_time:string}>} [overrides]
 */
function workingHoursFactory(overrides = {}) {
  return {
    day_of_week: 1,       // Monday  (0 = Sunday … 6 = Saturday)
    start_time:  '09:00',
    end_time:    '17:00',
    ...overrides,
  };
}

/**
 * Appointment payload shaped for availability-engine overlap / conflict tests.
 * Distinct from `appointmentFactory` which targets the appointments service CRUD.
 *
 * NOTE — schema alignment:
 * The existing `appointments` table uses `customer_id` as the FK, not `resource_id`.
 * The parameter is named `ownerId` here to stay neutral until the availability-engine
 * decides whether computation is anchored on customer_id (existing model) or on a new
 * resource/calendar concept. Pass the correct field via `overrides` when activating tests.
 *
 * @param {string} ownerId     - Required — customer_id or future resource_id
 * @param {Partial<{start:string, end:string}>} [overrides]
 */
function appointmentFactoryForAvailability(ownerId, overrides = {}) {
  if (!ownerId) throw new Error('appointmentFactoryForAvailability: ownerId is required');
  const base = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  base.setHours(10, 0, 0, 0);
  const end = new Date(base.getTime() + 30 * 60 * 1000);
  return {
    // Provide the correct FK key via overrides once the engine schema is finalised.
    // Example: appointmentFactoryForAvailability(customerId, { customer_id: customerId })
    owner_id: ownerId,
    start:    base.toISOString(),
    end:      end.toISOString(),
    ...overrides,
  };
}

/**
 * Exception day — marks a normally-working day as fully unavailable.
 *
 * @param {Partial<{date:string, reason:string}>} [overrides]
 */
function exceptionFactory(overrides = {}) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return {
    date:   tomorrow.toISOString().slice(0, 10),  // YYYY-MM-DD
    reason: `Exception ${seq()} – ${Date.now()}`,
    ...overrides,
  };
}

/**
 * Manual block — marks a specific time range as unavailable within a working day.
 *
 * @param {Partial<{start:string, end:string, reason:string}>} [overrides]
 */
function blockFactory(overrides = {}) {
  const base = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  base.setHours(14, 0, 0, 0);
  const end = new Date(base.getTime() + 60 * 60 * 1000);
  return {
    start:  base.toISOString(),
    end:    end.toISOString(),
    reason: `Block ${seq()} – ${Date.now()}`,
    ...overrides,
  };
}

/**
 * Free-slots query — asks for available slots in a date range for a given duration.
 *
 * @param {Partial<{from:string, to:string, duration_minutes:number, timezone:string}>} [overrides]
 */
function slotQueryFactory(overrides = {}) {
  const from = new Date(Date.now() + 24 * 60 * 60 * 1000);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    from:             from.toISOString(),
    to:               to.toISOString(),
    duration_minutes: 30,
    timezone:         'Europe/Berlin',
    ...overrides,
  };
}

/**
 * Slot-check query — asks whether a specific start time is bookable.
 *
 * @param {Partial<{start:string, duration_minutes:number, timezone:string}>} [overrides]
 */
function slotCheckFactory(overrides = {}) {
  const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  start.setHours(10, 0, 0, 0);
  return {
    start:            start.toISOString(),
    duration_minutes: 30,
    timezone:         'Europe/Berlin',
    ...overrides,
  };
}

/**
 * Next-free query — asks for the earliest bookable slot after a given point.
 *
 * @param {Partial<{after:string, duration_minutes:number, timezone:string}>} [overrides]
 */
function nextFreeFactory(overrides = {}) {
  const after = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return {
    after:            after.toISOString(),
    duration_minutes: 30,
    timezone:         'Europe/Berlin',
    ...overrides,
  };
}

/**
 * Day-view query — asks for working windows, busy windows and free slots for a date.
 *
 * @param {Partial<{date:string, timezone:string}>} [overrides]
 */
function dayViewFactory(overrides = {}) {
  const next = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return {
    date:     next.toISOString().slice(0, 10),  // YYYY-MM-DD
    timezone: 'Europe/Berlin',
    ...overrides,
  };
}

// ── Voice / VAPI ──────────────────────────────────────────────────────────────

/**
 * Generate a unique provider_call_id for each test run.
 * Combines a timestamp with a short random suffix to prevent collisions
 * across runs against the same persistent database.
 *
 * @param {string} [prefix='test-call-voice']
 * @returns {string}
 */
function uniqueVoiceCallId(prefix = 'test-call-voice') {
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${Date.now()}-${rnd}`;
}

// Tenant resolution via VAPI uses message.call.assistantId (provider_agent_id)
// or message.call.customer.number (phone_number).
// Set VAPI_ASSISTANT_ID in .env to match the provider_agent_id of a seeded
// active voice_agents row for Tenant A (booking track).
// Set VAPI_RESTAURANT_ASSISTANT_ID for the restaurant-track agent.
const VAPI_ASSISTANT_ID            = process.env.VAPI_ASSISTANT_ID            || '';
const VAPI_RESTAURANT_ASSISTANT_ID = process.env.VAPI_RESTAURANT_ASSISTANT_ID || '';
const VAPI_SALON_ASSISTANT_ID      = process.env.VAPI_SALON_ASSISTANT_ID      || '';
const VAPI_SALON_2_ASSISTANT_ID    = process.env.VAPI_SALON_2_ASSISTANT_ID    || '';
// Feature-gate test tenant (44444444-…): booking-track, voice-only features.
// Fixed value — matches the provider_agent_id seeded in 20260410000001.
const VAPI_FEATURE_GATE_ASSISTANT_ID = process.env.VAPI_FEATURE_GATE_ASSISTANT_ID || 'test-feature-gate-assistant-001';

/**
 * Build the VAPI call sub-object.
 * Includes all required schema fields: id, createdAt, updatedAt.
 * assistantId is included when provided (or falls back to VAPI_ASSISTANT_ID)
 * — required for tenant resolution if no matching phone number is registered.
 *
 * @param {string} callId
 * @param {string} [assistantId] - overrides VAPI_ASSISTANT_ID when supplied
 * @returns {object}
 */
function _buildVapiCall(callId, assistantId = VAPI_ASSISTANT_ID) {
  const now = new Date().toISOString();
  const call = {
    id:        callId,
    createdAt: now,
    updatedAt: now,
  };
  if (assistantId) call.assistantId = assistantId;
  return call;
}

/**
 * VAPI status-update webhook payload.
 * Sent by the provider when a call transitions to in-progress.
 *
 * @param {string} [callId]
 * @param {object} [overrides]    - merged into message object
 * @param {string} [assistantId]  - overrides the assistantId in call sub-object
 */
function buildVapiStatusUpdate(callId = VOICE_CALL_ID_1, overrides = {}, assistantId = undefined) {
  return {
    message: {
      type:      'status-update',
      call:      _buildVapiCall(callId, assistantId),
      status:    'in-progress',
      timestamp: new Date().toISOString(),
      ...overrides,
    },
  };
}

/**
 * VAPI tool-calls webhook payload.
 * Sent by the provider when the AI assistant invokes a tool during a call.
 *
 * @param {string} callId
 * @param {string} toolName      - tool function name (e.g. 'create_callback_request')
 * @param {object} [args]        - tool function arguments
 * @param {string} [assistantId] - overrides the assistantId in call sub-object
 */
function buildVapiToolCall(callId, toolName, args = {}, assistantId = undefined) {
  return {
    message: {
      type:         'tool-calls',
      call:         _buildVapiCall(callId, assistantId),
      timestamp:    new Date().toISOString(),
      toolCallList: [
        {
          id:       `tc-${Date.now()}-${seq()}`,
          type:     'function',
          function: {
            name:      toolName,
            arguments: args,
          },
        },
      ],
    },
  };
}

/**
 * VAPI end-of-call-report webhook payload.
 * Sent by the provider when the call ends. Backend sets status → completed.
 *
 * @param {string} [callId]
 * @param {object} [overrides] - merged into message object
 */
function buildVapiEndOfCallReport(callId = VOICE_CALL_ID_1, overrides = {}) {
  return {
    message: {
      type:            'end-of-call-report',
      call:            _buildVapiCall(callId),
      endedReason:     'customer-ended-call',
      summary:         'Test call completed successfully.',
      durationSeconds: 120,
      timestamp:       new Date().toISOString(),
      ...overrides,
    },
  };
}

/**
 * Return the JWT token for a given tenant (A or B).
 * Reads from config — requires dotenv to be loaded first.
 *
 * @param {'A'|'B'} [tenant='A']
 * @returns {string}
 */
function buildVoiceJwt(tenant = 'A') {
  const config = require('../config/config');
  return tenant === 'B' ? config.tokens.tenantB : config.tokens.tenantA;
}

module.exports = {
  customerFactory,
  requestFactory,
  resourceFactory,
  appointmentFactory,
  // Availability Engine / Calculation
  workingHoursFactory,
  appointmentFactoryForAvailability,
  exceptionFactory,
  blockFactory,
  slotQueryFactory,
  slotCheckFactory,
  nextFreeFactory,
  dayViewFactory,
  // Voice / VAPI
  uniqueVoiceCallId,
  buildVapiStatusUpdate,
  buildVapiToolCall,
  buildVapiEndOfCallReport,
  buildVoiceJwt,
  VAPI_ASSISTANT_ID,
  VAPI_RESTAURANT_ASSISTANT_ID,
  VAPI_SALON_ASSISTANT_ID,
  VAPI_SALON_2_ASSISTANT_ID,
  VAPI_FEATURE_GATE_ASSISTANT_ID,
  REQUEST_TYPES,
  REQUEST_STATUSES,
  RESOURCE_TYPES,
  RESOURCE_STATUSES,
  APPOINTMENT_STATUSES,
};
