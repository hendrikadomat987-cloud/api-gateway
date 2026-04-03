'use strict';

const fs   = require('fs');
const path = require('path');

const MIGRATION_FILE = path.resolve(
  __dirname, '..', '..', 'backend', 'migrations',
  '20260401000000_voice_v1_initial.sql'
);

/**
 * Create a fresh, uniquely-named schema, apply all voice migrations into it,
 * and return the schema name. Call teardownSchema() in afterAll to clean up.
 *
 * search_path is set to "<schemaName>, public" so that:
 *   - All tables created by the migration land in the test schema (isolated).
 *   - Extension functions in public (e.g. gen_random_uuid, pgcrypto) remain reachable.
 *
 * @param {import('pg').Client} client
 * @returns {Promise<string>} schemaName
 */
async function setupMigrationSchema(client) {
  const rnd        = Math.random().toString(36).slice(2, 6);
  const schemaName = `mig_${Date.now()}_${rnd}`;

  await client.query(`CREATE SCHEMA "${schemaName}"`);
  // Include public so gen_random_uuid() / extension functions resolve correctly.
  await client.query(`SET search_path TO "${schemaName}", public`);

  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  await client.query(sql);

  return schemaName;
}

/**
 * Drop the test schema and all its objects.
 *
 * @param {import('pg').Client} client
 * @param {string} schemaName
 */
async function teardownSchema(client, schemaName) {
  await client.query(`SET search_path TO public`);
  await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
}

module.exports = { setupMigrationSchema, teardownSchema, MIGRATION_FILE };
