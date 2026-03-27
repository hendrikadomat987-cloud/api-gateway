# availability-engine

Calculation service for tenant-aware free-slot discovery, bookability checks,
and schedule visualisation.

---

## Overview

The availability-engine is a **read-only calculation service**. It does not own
data — it reads from:

| Source table | Purpose |
|---|---|
| `availability` | Working hours (legacy CRUD, V1 primary source) |
| `resource_working_hours` | Working hours (extended; preferred when populated) |
| `appointments` | Busy periods (confirmed bookings) |
| `availability_blocks` | Manual time blocks |
| `availability_exceptions` | Day-level or partial-time overrides |

Calculation logic lives in **n8n Code nodes** (JavaScript).
Data retrieval uses **Supabase RPC helpers** (`ae_get_*`) that enforce RLS via
`set_config('app.current_tenant_id', ...)`.

---

## Endpoints

All endpoints accept **POST only**. The `tenant_id` is never accepted from the
client body — the API Gateway injects it from the JWT.

| Route | Body required | Body optional | Returns |
|---|---|---|---|
| `POST /api/v1/availability-engine/slots` | `customer_id`, `from`, `to` | `duration_minutes` (default 30), `timezone` (default `Europe/Berlin`) | `{ success, data: [{start, end}] }` |
| `POST /api/v1/availability-engine/check` | `customer_id`, `start` | `duration_minutes`, `timezone` | `{ success, data: { bookable, reason } }` |
| `POST /api/v1/availability-engine/next-free` | `customer_id`, `after` | `duration_minutes`, `timezone` | `{ success, data: { start, end } \| null }` |
| `POST /api/v1/availability-engine/day-view` | `customer_id`, `date` (YYYY-MM-DD) | `duration_minutes`, `timezone` | `{ success, data: { date, is_closed, working_windows, busy_windows, free_slots } }` |

### Error shape

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

Common codes: `VALIDATION_ERROR` (400), `METHOD_NOT_ALLOWED` (405),
`SERVICE_NOT_FOUND` (404), `DB_ERROR` (500 — from n8n Code node).

---

## Files

| File | Purpose |
|---|---|
| `availability-engine.sql` | SQL migration: tables + RLS + RPC helpers |
| `_ae_slots.json` | n8n workflow — `POST /availability-engine/slots` |
| `_ae_check.json` | n8n workflow — `POST /availability-engine/check` |
| `_ae_next-free.json` | n8n workflow — `POST /availability-engine/next-free` |
| `_ae_day-view.json` | n8n workflow — `POST /availability-engine/day-view` |

---

## Deployment

### 1. SQL migration

Apply `availability-engine.sql` to the Supabase database **after**
`availability.sql` and `appointments.sql`.

```sql
-- In Supabase SQL editor or psql:
\i availability-engine/availability-engine.sql
```

The migration is idempotent (`create if not exists`, `create or replace`).

### 2. n8n workflows

Import each `_ae_*.json` file into n8n (Settings → Import Workflow), then
**activate** each one. The webhook paths must match exactly:

- `availability-engine/slots`
- `availability-engine/check`
- `availability-engine/next-free`
- `availability-engine/day-view`

### 3. Gateway config

The API Gateway (`api-gateway/config.js`) already contains the service entry:

```js
'availability-engine': {
  SLOTS:     'availability-engine/slots',
  CHECK:     'availability-engine/check',
  NEXT_FREE: 'availability-engine/next-free',
  DAY_VIEW:  'availability-engine/day-view',
},
```

The dedicated route handler in `api-gateway/src/routes/apiRouter.js` is
registered before the generic CRUD router and handles all four operations.

---

## Calculation algorithm (slots)

1. Load working hours via `ae_get_working_hours` (prefers `resource_working_hours`,
   falls back to `availability`)
2. Load busy periods via `ae_get_busy_periods` (appointments + active blocks)
3. Load day exceptions via `ae_get_day_exceptions`
4. For each calendar day in `[from, to)`:
   - Skip if day is in `closedDates`
   - Skip if no working window exists for that day-of-week
   - For each working window: scan forward in `duration_minutes` increments,
     testing each candidate slot against all busy windows (expanded by buffers)
5. Return array of `{ start, end }` ISO strings

### Bookability check (check)

Same data load as slots, but for a single window `[start, start+duration)`:
1. Day closed? → `bookable: false, reason: 'day_closed'`
2. No working window for that day-of-week? → `bookable: false, reason: 'outside_working_hours'`
3. Slot not contained in any window? → `bookable: false, reason: 'outside_working_hours'`
4. Slot overlaps a partial exception? → `bookable: false, reason: 'partial_exception'`
5. Slot overlaps a busy period (with buffers)? → `bookable: false, reason: 'conflict'`
6. Otherwise → `bookable: true, reason: null`

---

## V1 data model notes

- V1 anchors computation on **`customer_id`** (using the existing `availability`
  and `appointments` tables). No new data needs to be populated for V1 to work.
- `resource_working_hours` is empty by default; `ae_get_working_hours` falls back
  to `availability` automatically.
- `availability_exceptions` and `availability_blocks` tables are created and
  included in busy-period lookups but can be left empty for the initial launch.

---

## Tests

Test scaffolds live in `test-engine-v2/services/availability-engine/` and are
**skipped** (`describe.skip`) until the workflows are deployed.

| File | Covers |
|---|---|
| `availability-engine.gateway.test.js` | Auth, input validation, method enforcement |
| `availability-engine.rls.test.js` | Cross-tenant isolation invariants |
| `availability-engine.calculation.test.js` | Slot math, conflicts, buffers, day-view |

To activate, replace every `describe.skip` with `describe` in each file after
completing the `beforeAll` setup TODOs.

```bash
# Run only availability-engine tests
npm run test:availability-engine --prefix test-engine-v2
```
