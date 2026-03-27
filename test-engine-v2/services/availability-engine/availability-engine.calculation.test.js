'use strict';

/**
 * availability-engine — Calculation / Engine Logic tests  [SCAFFOLD]
 *
 * STATUS: pending — availability-engine n8n workflows must be deployed first.
 *
 * All describe blocks use describe.skip so Jest counts them as pending
 * rather than executing them against a non-existent endpoint.
 *
 * HOW TO ACTIVATE:
 *   1. Deploy all four availability-engine n8n workflows and activate them.
 *   2. Replace every `describe.skip` with `describe`.
 *   3. Implement beforeAll setup (create customer, working hours, appointments, blocks).
 *      Working hours → POST /api/v1/availability  (existing CRUD)
 *      Appointments  → POST /api/v1/appointments  (existing CRUD)
 *      Blocks        → POST /api/v1/availability-blocks  (add to gateway config if needed)
 *   4. Replace `customerId` placeholder with the seeded customer's ID.
 *   5. Run: npm run test:availability-engine
 *
 * CALCULATION INVARIANTS VERIFIED:
 *   - working hours minus appointments = correct free slots
 *   - slots outside working hours are never returned/bookable
 *   - overlapping appointment blocks a slot
 *   - buffer time blocks adjacent slots
 *   - exception days and manual blocks reduce availability
 *   - next-free returns the earliest genuinely available slot
 *   - day-view returns all three arrays with correct structure
 *   - no-slot-found is handled gracefully (not a server error)
 *
 * V1 NOTE: All queries are anchored on customer_id, not resource_id.
 *   Working hours are stored in the `availability` table (or `resource_working_hours`
 *   once populated). The engine always falls back to `availability` when
 *   `resource_working_hours` is empty for the given customer.
 */

const { createClient }    = require('../../core/apiClient');
const { TestContext }     = require('../../core/context');
const { cleanupContext }  = require('../../core/cleanup');
const config              = require('../../config/config');
const {
  expectSuccess,
  expectFreeSlotsArray,
  expectSlotWindow,
  expectBookableTrue,
  expectBookableFalseWithReason,
  expectNoSlotOverlap,
  expectDayViewShape,
}                         = require('../../core/assertions');
const {
  workingHoursFactory,
  appointmentFactory,
  exceptionFactory,
  blockFactory,
  slotQueryFactory,
  slotCheckFactory,
  nextFreeFactory,
  dayViewFactory,
}                         = require('../../core/factories');

const ENDPOINTS = {
  // V1 calculation endpoints (POST only)
  slots:    '/api/v1/availability-engine/slots',
  check:    '/api/v1/availability-engine/check',
  nextFree: '/api/v1/availability-engine/next-free',
  dayView:  '/api/v1/availability-engine/day-view',
  // Setup via existing CRUD services
  availability:  '/api/v1/availability',   // working hours (existing service)
  appointments:  '/api/v1/appointments',   // busy periods (existing service)
};

const client = createClient({ token: config.tokens.tenantA });
const ctx    = new TestContext();

// ── Test data helpers ──────────────────────────────────────────────────────────

/** Returns an ISO string for next Monday at the given UTC hour. */
function nextMondayAt(hour) {
  const d = new Date();
  const daysUntilMonday = (8 - d.getUTCDay()) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** Returns YYYY-MM-DD string for next Monday. */
function nextMondayDate() {
  return nextMondayAt(0).slice(0, 10);
}

// ── Working hours → free slots ─────────────────────────────────────────────────

describe.skip('availability-engine / calculation / free-slots from working hours', () => {
  let customerId;

  beforeAll(async () => {
    // TODO:
    // 1. POST /api/v1/customer → get customerId
    // 2. POST /api/v1/availability with workingHoursFactory({ day_of_week: 1, customer_id: customerId })
    //    to set Monday 09:00–17:00 working hours
    // ctx.register('customers', customerId);
  });

  afterAll(async () => {
    await cleanupContext(ctx, { client });
  });

  it('returns a non-empty array of free slots within working hours', async () => {
    const body  = slotQueryFactory({
      customer_id:      customerId,
      from:             nextMondayAt(0),
      to:               nextMondayAt(23),
      duration_minutes: 30,
    });
    const res   = await client.post(ENDPOINTS.slots, body);
    const slots = expectFreeSlotsArray(res);
    slots.forEach(expectSlotWindow);
  });

  it('every returned slot falls within declared working hours (09:00–17:00)', async () => {
    const body  = slotQueryFactory({
      customer_id:      customerId,
      from:             nextMondayAt(0),
      to:               nextMondayAt(23),
      duration_minutes: 30,
    });
    const res   = await client.post(ENDPOINTS.slots, body);
    const slots = expectFreeSlotsArray(res);
    for (const slot of slots) {
      const startHour = new Date(slot.start).getUTCHours();
      const endHour   = new Date(slot.end).getUTCHours();
      const endMin    = new Date(slot.end).getUTCMinutes();
      expect(startHour).toBeGreaterThanOrEqual(9);
      // end must be ≤ 17:00  (endHour < 17, or endHour === 17 && endMin === 0)
      expect(endHour * 60 + endMin).toBeLessThanOrEqual(17 * 60);
    }
  });

  it('returned slots do not overlap each other', async () => {
    const body  = slotQueryFactory({
      customer_id:      customerId,
      from:             nextMondayAt(0),
      to:               nextMondayAt(23),
      duration_minutes: 30,
    });
    const res   = await client.post(ENDPOINTS.slots, body);
    const slots = expectFreeSlotsArray(res);
    expectNoSlotOverlap(slots);
  });
});

// ── Slot outside working hours is not bookable ─────────────────────────────────

describe.skip('availability-engine / calculation / slot outside working hours', () => {
  let customerId;

  it('slot at 07:00 (before working hours) → bookable: false', async () => {
    const body = slotCheckFactory({
      customer_id:      customerId,
      start:            nextMondayAt(7),  // 07:00 — before 09:00 window
      duration_minutes: 30,
    });
    const res = await client.post(ENDPOINTS.check, body);
    expectBookableFalseWithReason(res);
  });

  it('slot at 18:00 (after working hours) → bookable: false', async () => {
    const body = slotCheckFactory({
      customer_id:      customerId,
      start:            nextMondayAt(18),  // 18:00 — after 17:00 window
      duration_minutes: 30,
    });
    const res = await client.post(ENDPOINTS.check, body);
    expectBookableFalseWithReason(res);
  });
});

// ── Appointment creates conflict ───────────────────────────────────────────────

describe.skip('availability-engine / calculation / overlap blocks slot', () => {
  let customerId;

  it('slot exactly overlapping an existing appointment → bookable: false', async () => {
    // Assumes an appointment at Monday 10:00–10:30 was created in setup.
    const body = slotCheckFactory({
      customer_id:      customerId,
      start:            nextMondayAt(10),
      duration_minutes: 30,
    });
    const res = await client.post(ENDPOINTS.check, body);
    expectBookableFalseWithReason(res, 'conflict');
  });

  it('slot adjacent but NOT overlapping an appointment → bookable: true', async () => {
    // 10:30 slot starts exactly when the 10:00–10:30 appointment ends → should be free.
    // NOTE: if a buffer_before_min/buffer_after_min rule is active this may be bookable:false
    const appointmentEndMs = new Date(nextMondayAt(10)).getTime() + 30 * 60 * 1000;
    const body = slotCheckFactory({
      customer_id:      customerId,
      start:            new Date(appointmentEndMs).toISOString(),
      duration_minutes: 30,
    });
    const res = await client.post(ENDPOINTS.check, body);
    expectBookableTrue(res);
  });
});

// ── Buffer time ────────────────────────────────────────────────────────────────

describe.skip('availability-engine / calculation / buffer blocks adjacent slots', () => {
  let customerId;

  it('slot within buffer window of an existing appointment → bookable: false', async () => {
    // Requires the working hours entry to have buffer_before_min or buffer_after_min set.
    // If the service applies e.g. 15-min buffer after each appointment (10:00–10:30),
    // the 10:30–11:00 slot must be blocked.
    // TODO: configure customer's working hours with buffer_after_min=15 and adjust timing here.
    const appointmentEndMs = new Date(nextMondayAt(10)).getTime() + 30 * 60 * 1000;
    const body = slotCheckFactory({
      customer_id:      customerId,
      start:            new Date(appointmentEndMs).toISOString(), // within buffer window
      duration_minutes: 30,
    });
    const res = await client.post(ENDPOINTS.check, body);
    expectBookableFalseWithReason(res);
  });
});

// ── Exception day blocks entire day ───────────────────────────────────────────

describe.skip('availability-engine / calculation / exception day', () => {
  let customerId;

  it('free-slots query on exception day returns empty array', async () => {
    const exceptionDate = nextMondayDate();
    // Assumes an exception for exceptionDate was created in beforeAll via availability_exceptions table.
    const body = slotQueryFactory({
      customer_id:      customerId,
      from:             `${exceptionDate}T00:00:00.000Z`,
      to:               `${exceptionDate}T23:59:59.999Z`,
      duration_minutes: 30,
    });
    const res = await client.post(ENDPOINTS.slots, body);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data).toEqual([]);
  });

  it('slot-check on exception day → bookable: false with reason day_closed', async () => {
    const body = slotCheckFactory({
      customer_id:      customerId,
      start:            `${nextMondayDate()}T10:00:00.000Z`,
      duration_minutes: 30,
    });
    const res = await client.post(ENDPOINTS.check, body);
    expectBookableFalseWithReason(res, 'day_closed');
  });
});

// ── Manual block ───────────────────────────────────────────────────────────────

describe.skip('availability-engine / calculation / manual block', () => {
  let customerId;

  it('slot within a manual block → bookable: false', async () => {
    // Assumes a block at Monday 14:00–15:00 was created in beforeAll via availability_blocks table.
    const body = slotCheckFactory({
      customer_id:      customerId,
      start:            nextMondayAt(14),
      duration_minutes: 30,
    });
    const res = await client.post(ENDPOINTS.check, body);
    expectBookableFalseWithReason(res, 'conflict');
  });

  it('slot outside the manual block window → bookable: true', async () => {
    const body = slotCheckFactory({
      customer_id:      customerId,
      start:            nextMondayAt(11),  // 11:00 — outside the 14:00–15:00 block
      duration_minutes: 30,
    });
    const res = await client.post(ENDPOINTS.check, body);
    expectBookableTrue(res);
  });
});

// ── Next-free slot ─────────────────────────────────────────────────────────────

describe.skip('availability-engine / calculation / next-free', () => {
  let customerId;

  it('returns the earliest genuinely available slot', async () => {
    const body = nextFreeFactory({ customer_id: customerId });
    const res  = await client.post(ENDPOINTS.nextFree, body);
    expectSuccess(res);
    const slot = res.data.data;
    expect(slot).toBeDefined();
    expectSlotWindow(slot);
  });

  it('next-free slot is within declared working hours', async () => {
    const body = nextFreeFactory({ customer_id: customerId });
    const res  = await client.post(ENDPOINTS.nextFree, body);
    expectSuccess(res);
    const slot      = res.data.data;
    const startHour = new Date(slot.start).getUTCHours();
    expect(startHour).toBeGreaterThanOrEqual(9);
    expect(startHour).toBeLessThan(17);
  });

  it('returns null data when no slot is available within the search horizon', async () => {
    // Query starting in the past — engine will scan forward and find nothing
    // (no working hours configured for historical dates).
    const body = nextFreeFactory({
      customer_id: customerId,
      after:       '1970-01-01T00:00:00.000Z',
    });
    const res = await client.post(ENDPOINTS.nextFree, body);
    // Acceptable: 200 with null data (no slot found), not a 500
    expect(res.status).not.toBe(500);
    if (res.status === 200 && res.data.success) {
      // null means no free slot found within 60-day horizon starting from 1970
      expect(res.data.data).toBeNull();
    }
  });
});

// ── Day view ───────────────────────────────────────────────────────────────────

describe.skip('availability-engine / calculation / day-view', () => {
  let customerId;

  it('returns working_windows, busy_windows and free_slots for a working day', async () => {
    const body = dayViewFactory({
      customer_id: customerId,
      date:        nextMondayDate(),
    });
    const res  = await client.post(ENDPOINTS.dayView, body);
    const data = expectDayViewShape(res);
    expect(data.working_windows.length).toBeGreaterThan(0);
    data.working_windows.forEach(expectSlotWindow);
    data.busy_windows.forEach(expectSlotWindow);
    data.free_slots.forEach(expectSlotWindow);
  });

  it('free_slots in day-view do not overlap each other', async () => {
    const body = dayViewFactory({
      customer_id: customerId,
      date:        nextMondayDate(),
    });
    const res  = await client.post(ENDPOINTS.dayView, body);
    const data = expectDayViewShape(res);
    expectNoSlotOverlap(data.free_slots);
  });

  it('returns empty arrays and is_closed:true for an exception day', async () => {
    // Assumes an exception for nextMondayDate() was registered in a prior test group.
    const body = dayViewFactory({
      customer_id: customerId,
      date:        nextMondayDate(),
    });
    const res  = await client.post(ENDPOINTS.dayView, body);
    const data = expectDayViewShape(res);
    expect(data.is_closed).toBe(true);
    expect(data.free_slots).toEqual([]);
  });

  it('total free_slots duration does not exceed working_windows duration', async () => {
    const body = dayViewFactory({
      customer_id: customerId,
      date:        nextMondayDate(),
    });
    const res  = await client.post(ENDPOINTS.dayView, body);
    const data = expectDayViewShape(res);

    const durationMs = (windows) =>
      windows.reduce((sum, w) => sum + (new Date(w.end) - new Date(w.start)), 0);

    expect(durationMs(data.free_slots)).toBeLessThanOrEqual(durationMs(data.working_windows));
  });
});
