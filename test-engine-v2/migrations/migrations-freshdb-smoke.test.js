'use strict';

/**
 * migrations / freshdb-smoke
 *
 * End-to-end smoke test against a fresh schema:
 *   1. Apply voice migration (tables, indexes, RLS, FKs)
 *   2. Seed required base data: voice_provider → voice_agent
 *   3. Simulate a minimal call lifecycle:
 *        INSERT voice_call  (status: in_progress)
 *        INSERT voice_event (call.status_update)
 *        UPDATE voice_call  (status: completed, duration_seconds, summary)
 *        INSERT voice_event (call.ended)
 *   4. Assert queryability of call + events
 *   5. Assert UNIQUE constraint on provider_call_id (idempotency guard)
 *
 * tenant context is set via set_config('app.current_tenant', ...) before each
 * operation, mirroring what the Fastify middleware does at request time.
 * If the DB connection is a PostgreSQL superuser (e.g. Docker postgres default),
 * RLS is bypassed — the structural smoke still validates the data flow.
 * For RLS enforcement, see migrations-rls.test.js.
 *
 * Requires: MIGRATION_TEST_DB_URL set in test-engine-v2/.env
 */

const { isDbConfigured, createClient, releaseClient } = require('./db-client');
const { setupMigrationSchema, teardownSchema }        = require('./migration-runner');

// ─────────────────────────────────────────────────────────────────────────────

// Fixed test tenant UUID — stable across all smoke assertions
const TENANT_A = '11111111-1111-1111-1111-111111111111';

// ─────────────────────────────────────────────────────────────────────────────

(isDbConfigured() ? describe : describe.skip)('migrations / freshdb-smoke', () => {
  let client;
  let schemaName;

  // Seeded IDs — shared across ordered test steps
  let providerId;
  let agentId;
  let callId;

  beforeAll(async () => {
    client     = await createClient();
    schemaName = await setupMigrationSchema(client);
    // Set tenant context for the duration of this test session.
    // set_config(name, value, is_local=false) → session-level, persists beyond transactions.
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [TENANT_A]);
  }, 60_000);

  afterAll(async () => {
    if (client) {
      await teardownSchema(client, schemaName);
      await releaseClient(client);
    }
  });

  // ── Seed: voice_provider ───────────────────────────────────────────────────

  it('seed — can insert voice_provider', async () => {
    const res = await client.query(
      `INSERT INTO voice_providers (tenant_id, provider_type, name, status)
       VALUES ($1, 'vapi', 'Smoke Test Provider', 'active')
       RETURNING id`,
      [TENANT_A]
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].id).toBeTruthy();
    providerId = res.rows[0].id;
  });

  // ── Seed: voice_agent ──────────────────────────────────────────────────────

  it('seed — can insert voice_agent linked to provider', async () => {
    const res = await client.query(
      `INSERT INTO voice_agents
         (tenant_id, voice_provider_id, provider_agent_id, name, status)
       VALUES ($1, $2, 'smoke-agent-001', 'Smoke Agent', 'active')
       RETURNING id`,
      [TENANT_A, providerId]
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].id).toBeTruthy();
    agentId = res.rows[0].id;
  });

  // ── Call lifecycle: step 1 — call created ──────────────────────────────────

  it('lifecycle — can insert voice_call (in_progress)', async () => {
    const res = await client.query(
      `INSERT INTO voice_calls
         (tenant_id, voice_provider_id, voice_agent_id, provider_call_id, direction, status)
       VALUES ($1, $2, $3, 'smoke-call-001', 'inbound', 'in_progress')
       RETURNING id, status`,
      [TENANT_A, providerId, agentId]
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].status).toBe('in_progress');
    callId = res.rows[0].id;
  });

  // ── Call lifecycle: step 2 — status-update event ───────────────────────────

  it('lifecycle — can insert voice_event (call.status_update)', async () => {
    const rawPayload = JSON.stringify({ type: 'status-update', status: 'in-progress' });
    const res = await client.query(
      `INSERT INTO voice_events
         (tenant_id, voice_provider_id, voice_call_id,
          event_type, event_ts, raw_payload_json, processing_status)
       VALUES ($1, $2, $3, 'call.status_update', NOW(), $4::jsonb, 'processed')
       RETURNING id, event_ts`,
      [TENANT_A, providerId, callId, rawPayload]
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].id).toBeTruthy();
    // event_ts must be populated — this column is central to timeline assertions
    expect(res.rows[0].event_ts).toBeTruthy();
  });

  // ── Call lifecycle: step 3 — call completed ────────────────────────────────

  it('lifecycle — can update voice_call to completed with duration + summary', async () => {
    const res = await client.query(
      `UPDATE voice_calls
       SET status = 'completed', duration_seconds = 90,
           summary = 'Smoke test call ended cleanly.', ended_at = NOW()
       WHERE id = $1
       RETURNING status, duration_seconds, summary`,
      [callId]
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].status).toBe('completed');
    expect(res.rows[0].duration_seconds).toBe(90);
    expect(res.rows[0].summary).toBe('Smoke test call ended cleanly.');
  });

  // ── Call lifecycle: step 4 — end-of-call event ────────────────────────────

  it('lifecycle — can insert voice_event (call.ended)', async () => {
    const rawPayload = JSON.stringify({
      type:            'end-of-call-report',
      endedReason:     'customer-ended-call',
      durationSeconds: 90,
    });
    const res = await client.query(
      `INSERT INTO voice_events
         (tenant_id, voice_provider_id, voice_call_id,
          event_type, event_ts, raw_payload_json, processing_status)
       VALUES ($1, $2, $3, 'call.ended', NOW(), $4::jsonb, 'processed')
       RETURNING id, event_type, event_ts`,
      [TENANT_A, providerId, callId, rawPayload]
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].event_type).toBe('call.ended');
    expect(res.rows[0].event_ts).toBeTruthy();
  });

  // ── Query: call is retrievable ─────────────────────────────────────────────

  it('query — completed call is retrievable by tenant + provider_call_id', async () => {
    const res = await client.query(
      `SELECT id, provider_call_id, status, duration_seconds, summary
       FROM voice_calls
       WHERE tenant_id = $1 AND provider_call_id = $2`,
      [TENANT_A, 'smoke-call-001']
    );
    expect(res.rows).toHaveLength(1);
    const call = res.rows[0];
    expect(call.id).toBe(callId);
    expect(call.status).toBe('completed');
    expect(call.duration_seconds).toBe(90);
    expect(call.summary).toBe('Smoke test call ended cleanly.');
  });

  // ── Query: events are retrievable ─────────────────────────────────────────

  it('query — both events are retrievable for the call', async () => {
    const res = await client.query(
      `SELECT event_type, event_ts
       FROM voice_events
       WHERE voice_call_id = $1
       ORDER BY event_ts ASC`,
      [callId]
    );
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].event_type).toBe('call.status_update');
    expect(res.rows[1].event_type).toBe('call.ended');
    // Both events must have a valid event_ts — relied on by API assertions
    for (const ev of res.rows) {
      expect(ev.event_ts).toBeTruthy();
    }
  });

  // ── Idempotency guard: UNIQUE constraint on provider_call_id ───────────────

  it('constraint — uq_voice_calls_provider_call rejects duplicate provider_call_id', async () => {
    await expect(
      client.query(
        `INSERT INTO voice_calls
           (tenant_id, voice_provider_id, provider_call_id, direction, status)
         VALUES ($1, $2, 'smoke-call-001', 'inbound', 'created')`,
        [TENANT_A, providerId]
      )
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  // ── Agent unique constraint ────────────────────────────────────────────────

  it('constraint — uq_voice_agents_tenant_provider_agent rejects duplicate agent', async () => {
    await expect(
      client.query(
        `INSERT INTO voice_agents
           (tenant_id, voice_provider_id, provider_agent_id, name, status)
         VALUES ($1, $2, 'smoke-agent-001', 'Duplicate Agent', 'active')`,
        [TENANT_A, providerId]
      )
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  // ── Check constraints ──────────────────────────────────────────────────────

  it('constraint — chk_voice_calls_status rejects invalid status', async () => {
    await expect(
      client.query(
        `INSERT INTO voice_calls
           (tenant_id, voice_provider_id, provider_call_id, direction, status)
         VALUES ($1, $2, 'smoke-call-bad-status', 'inbound', 'invalid_status')`,
        [TENANT_A, providerId]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('constraint — chk_voice_calls_direction rejects invalid direction', async () => {
    await expect(
      client.query(
        `INSERT INTO voice_calls
           (tenant_id, voice_provider_id, provider_call_id, direction, status)
         VALUES ($1, $2, 'smoke-call-bad-dir', 'sideways', 'created')`,
        [TENANT_A, providerId]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('constraint — chk_voice_calls_duration_positive rejects negative duration', async () => {
    await expect(
      client.query(
        `UPDATE voice_calls SET duration_seconds = -1 WHERE id = $1`,
        [callId]
      )
    ).rejects.toThrow(/violates check constraint/);
  });
});
