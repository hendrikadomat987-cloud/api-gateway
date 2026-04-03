'use strict';

/**
 * migrations / schema
 *
 * Applies the voice migration to a fresh, isolated PostgreSQL schema and
 * verifies the structural result:
 *   - All 8 voice tables exist
 *   - Critical columns are present (event_ts, provider_call_id, duration_seconds, summary …)
 *   - UNIQUE constraints are present (idempotency / data-integrity guards)
 *   - Foreign-key constraints are present (referential integrity)
 *   - Performance indexes are present
 *
 * Requires: MIGRATION_TEST_DB_URL set in test-engine-v2/.env
 * Skip behaviour: if MIGRATION_TEST_DB_URL is absent, all tests are skipped
 * with an explanatory message — no hard failure.
 */

const { isDbConfigured, createClient, releaseClient } = require('./db-client');
const { setupMigrationSchema, teardownSchema }        = require('./migration-runner');

// ─────────────────────────────────────────────────────────────────────────────

(isDbConfigured() ? describe : describe.skip)('migrations / schema', () => {
  let client;
  let schemaName;

  beforeAll(async () => {
    client     = await createClient();
    schemaName = await setupMigrationSchema(client);
  }, 60_000);

  afterAll(async () => {
    if (client) {
      await teardownSchema(client, schemaName);
      await releaseClient(client);
    }
  });

  // ── Catalog helpers ────────────────────────────────────────────────────────

  async function tableExists(tableName) {
    const res = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2`,
      [schemaName, tableName]
    );
    return res.rows.length === 1;
  }

  async function columnExists(tableName, columnName) {
    const res = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [schemaName, tableName, columnName]
    );
    return res.rows.length === 1;
  }

  async function constraintExists(constraintName) {
    const res = await client.query(
      `SELECT 1 FROM information_schema.table_constraints
       WHERE constraint_schema = $1 AND constraint_name = $2`,
      [schemaName, constraintName]
    );
    return res.rows.length === 1;
  }

  async function indexExists(indexName) {
    const res = await client.query(
      `SELECT 1 FROM pg_indexes
       WHERE schemaname = $1 AND indexname = $2`,
      [schemaName, indexName]
    );
    return res.rows.length === 1;
  }

  // ── Tables ─────────────────────────────────────────────────────────────────

  const EXPECTED_TABLES = [
    'voice_providers',
    'voice_agents',
    'voice_numbers',
    'voice_calls',
    'voice_sessions',
    'voice_events',
    'voice_tool_invocations',
    'voice_order_contexts',
  ];

  for (const tableName of EXPECTED_TABLES) {
    it(`table '${tableName}' exists`, async () => {
      const exists = await tableExists(tableName);
      if (!exists) {
        throw new Error(
          `Expected table '${tableName}' not found in schema '${schemaName}' after migration.\n` +
          `Check: backend/migrations/20260401000000_voice_v1_initial.sql`
        );
      }
    });
  }

  // ── Critical columns ────────────────────────────────────────────────────────

  const EXPECTED_COLUMNS = [
    // voice_events — idempotency key + timeline
    ['voice_events', 'event_ts'],
    ['voice_events', 'tenant_id'],
    ['voice_events', 'raw_payload_json'],
    ['voice_events', 'processing_status'],
    ['voice_events', 'provider_event_id'],
    // voice_calls — provider linkage + outcome fields
    ['voice_calls',  'provider_call_id'],
    ['voice_calls',  'duration_seconds'],
    ['voice_calls',  'summary'],
    ['voice_calls',  'tenant_id'],
    ['voice_calls',  'status'],
    ['voice_calls',  'direction'],
    // voice_providers
    ['voice_providers', 'tenant_id'],
    ['voice_providers', 'provider_type'],
    // voice_sessions
    ['voice_sessions', 'voice_call_id'],
    ['voice_sessions', 'track_type'],
    ['voice_sessions', 'context_json'],
  ];

  for (const [table, column] of EXPECTED_COLUMNS) {
    it(`column '${table}.${column}' exists`, async () => {
      const exists = await columnExists(table, column);
      if (!exists) {
        throw new Error(
          `Expected column '${column}' on table '${table}' not found.\n` +
          `Schema: ${schemaName}`
        );
      }
    });
  }

  // ── UNIQUE constraints ─────────────────────────────────────────────────────
  //
  // These are load-bearing for idempotency (uq_voice_calls_provider_call prevents
  // duplicate call rows on repeated webhook delivery) and for data integrity.

  const EXPECTED_UNIQUE = [
    'uq_voice_calls_provider_call',            // idempotency: (provider_id, provider_call_id)
    'uq_voice_agents_tenant_provider_agent',   // idempotency: no duplicate agent registrations
    'uq_voice_numbers_tenant_phone',           // integrity: phone number unique per tenant
    'uq_voice_order_contexts_voice_session_id', // 1:1 session ↔ order context
  ];

  for (const name of EXPECTED_UNIQUE) {
    it(`UNIQUE constraint '${name}' exists`, async () => {
      const exists = await constraintExists(name);
      if (!exists) {
        throw new Error(
          `UNIQUE constraint '${name}' not found in schema '${schemaName}'.\n` +
          `This constraint is required for idempotency and data integrity.`
        );
      }
    });
  }

  // ── Foreign-key constraints ────────────────────────────────────────────────

  const EXPECTED_FK = [
    'fk_voice_agents_voice_provider_id',
    'fk_voice_numbers_voice_provider_id',
    'fk_voice_numbers_voice_agent_id',
    'fk_voice_calls_voice_provider_id',
    'fk_voice_calls_voice_agent_id',
    'fk_voice_calls_voice_number_id',
    'fk_voice_sessions_voice_call_id',
    'fk_voice_events_voice_provider_id',
    'fk_voice_events_voice_call_id',
    'fk_voice_events_voice_session_id',
    'fk_voice_tool_invocations_voice_call_id',
    'fk_voice_tool_invocations_voice_session_id',
    'fk_voice_order_contexts_voice_call_id',
    'fk_voice_order_contexts_voice_session_id',
  ];

  for (const name of EXPECTED_FK) {
    it(`FK constraint '${name}' exists`, async () => {
      const exists = await constraintExists(name);
      if (!exists) {
        throw new Error(
          `FK constraint '${name}' not found in schema '${schemaName}'.`
        );
      }
    });
  }

  // ── Performance indexes ────────────────────────────────────────────────────

  const EXPECTED_INDEXES = [
    // Tenant scans (every query starts here)
    'idx_voice_providers_tenant_id',
    'idx_voice_agents_tenant_id',
    'idx_voice_numbers_tenant_id',
    'idx_voice_calls_tenant_id',
    'idx_voice_sessions_tenant_id',
    'idx_voice_events_tenant_id',
    'idx_voice_tool_invocations_tenant_id',
    'idx_voice_order_contexts_tenant_id',
    // Operational indexes
    'idx_voice_calls_status',
    'idx_voice_calls_started_at',
    'idx_voice_events_voice_call_id',
    'idx_voice_events_processing_status',
    'idx_voice_events_event_type',
    'idx_voice_providers_tenant_provider_type_status',
  ];

  for (const name of EXPECTED_INDEXES) {
    it(`index '${name}' exists`, async () => {
      const exists = await indexExists(name);
      if (!exists) {
        throw new Error(
          `Index '${name}' not found in schema '${schemaName}'.\n` +
          `Indexes are required for tenant-scoped query performance.`
        );
      }
    });
  }
});
