'use strict';

/**
 * migrations / rls
 *
 * Verifies that the voice migration correctly configures Row Level Security
 * on every voice table. Checks the PostgreSQL system catalogs directly
 * (pg_class, pg_policy) — no data insertion required.
 *
 * What is checked per table:
 *   1. relrowsecurity = true   — RLS is enabled
 *   2. relforcerowsecurity = true — FORCE RLS: service role / table owner also bound
 *   3. At least one policy exists
 *   4. The policy expression references 'app.current_tenant' (tenant isolation)
 *
 * Requires: MIGRATION_TEST_DB_URL set in test-engine-v2/.env
 */

const { isDbConfigured, createClient, releaseClient } = require('./db-client');
const { setupMigrationSchema, teardownSchema }        = require('./migration-runner');

// ─────────────────────────────────────────────────────────────────────────────

(isDbConfigured() ? describe : describe.skip)('migrations / rls', () => {
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

  /**
   * Returns relrowsecurity + relforcerowsecurity for a table in the test schema.
   *
   * @param {string} tableName
   * @returns {Promise<{relrowsecurity: boolean, relforcerowsecurity: boolean} | null>}
   */
  async function getRlsFlags(tableName) {
    const res = await client.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2`,
      [schemaName, tableName]
    );
    return res.rows[0] ?? null;
  }

  /**
   * Returns all RLS policies for a table in the test schema, including
   * the human-readable USING and WITH CHECK expressions via pg_get_expr.
   *
   * @param {string} tableName
   * @returns {Promise<Array<{polname: string, using_expr: string|null, with_check_expr: string|null}>>}
   */
  async function getPolicies(tableName) {
    const res = await client.query(
      `SELECT p.polname,
              pg_get_expr(p.polqual,      c.oid) AS using_expr,
              pg_get_expr(p.polwithcheck, c.oid) AS with_check_expr
       FROM pg_policy p
       JOIN pg_class     c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2`,
      [schemaName, tableName]
    );
    return res.rows;
  }

  // ── Per-table RLS assertions ───────────────────────────────────────────────

  const VOICE_TABLES = [
    'voice_providers',
    'voice_agents',
    'voice_numbers',
    'voice_calls',
    'voice_sessions',
    'voice_events',
    'voice_tool_invocations',
    'voice_order_contexts',
  ];

  for (const tableName of VOICE_TABLES) {
    // ── 1. RLS enabled ───────────────────────────────────────────────────────

    it(`${tableName}: ROW LEVEL SECURITY is enabled`, async () => {
      const flags = await getRlsFlags(tableName);
      if (!flags) {
        throw new Error(`Table '${tableName}' not found in schema '${schemaName}'.`);
      }
      if (!flags.relrowsecurity) {
        throw new Error(
          `Table '${tableName}' does NOT have RLS enabled.\n` +
          `Expected: ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;\n` +
          `Without RLS, all tenants can read each other's voice data.`
        );
      }
    });

    // ── 2. FORCE RLS enabled ─────────────────────────────────────────────────

    it(`${tableName}: FORCE ROW LEVEL SECURITY is enabled`, async () => {
      const flags = await getRlsFlags(tableName);
      if (!flags) {
        throw new Error(`Table '${tableName}' not found in schema '${schemaName}'.`);
      }
      if (!flags.relforcerowsecurity) {
        throw new Error(
          `Table '${tableName}' does NOT have FORCE ROW LEVEL SECURITY.\n` +
          `Expected: ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY;\n` +
          `Without FORCE RLS, the table owner / service role bypasses tenant isolation.`
        );
      }
    });

    // ── 3. At least one policy exists ────────────────────────────────────────

    it(`${tableName}: at least one RLS policy exists`, async () => {
      const policies = await getPolicies(tableName);
      if (policies.length === 0) {
        throw new Error(
          `No RLS policies found on '${tableName}' (schema '${schemaName}').\n` +
          `RLS is enabled but without policies all rows are hidden by default.`
        );
      }
    });

    // ── 4. Policy references app.current_tenant ──────────────────────────────

    it(`${tableName}: policy references 'app.current_tenant' for tenant isolation`, async () => {
      const policies = await getPolicies(tableName);
      const hasTenantIsolation = policies.some(
        (p) =>
          (p.using_expr      && p.using_expr.includes('current_tenant')) ||
          (p.with_check_expr && p.with_check_expr.includes('current_tenant'))
      );
      if (!hasTenantIsolation) {
        throw new Error(
          `No policy on '${tableName}' references 'app.current_tenant'.\n` +
          `Policies found: ${JSON.stringify(policies.map((p) => p.polname))}\n` +
          `Expressions:\n${policies.map((p) =>
            `  ${p.polname}: USING(${p.using_expr}) WITH CHECK(${p.with_check_expr})`
          ).join('\n')}\n` +
          `Expected pattern: tenant_id = current_setting('app.current_tenant', true)::uuid`
        );
      }
    });
  }
});
