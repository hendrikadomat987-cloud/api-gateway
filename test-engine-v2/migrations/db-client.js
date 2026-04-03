'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const DB_URL = process.env.MIGRATION_TEST_DB_URL;

/**
 * Returns true when MIGRATION_TEST_DB_URL is configured.
 * Migration tests skip themselves cleanly when this returns false.
 */
function isDbConfigured() {
  return !!DB_URL;
}

/**
 * Create and return a connected pg.Client for migration testing.
 * Each test file acquires its own client; pass it to releaseClient() in afterAll.
 *
 * @returns {Promise<import('pg').Client>}
 */
async function createClient() {
  if (!DB_URL) {
    throw new Error(
      'MIGRATION_TEST_DB_URL is not set.\n' +
      'Add it to test-engine-v2/.env to run migration tests.\n' +
      '\n' +
      'Docker quick-start:\n' +
      '  docker run -d --name pg-test -p 5432:5432 \\\n' +
      '    -e POSTGRES_PASSWORD=test postgres:16-alpine\n' +
      '\n' +
      'Then set in test-engine-v2/.env:\n' +
      '  MIGRATION_TEST_DB_URL=postgresql://postgres:test@localhost:5432/postgres'
    );
  }

  // Lazy require — pg is only needed when running migration tests.
  const { Client } = require('pg');
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

/**
 * End a client connection.
 *
 * @param {import('pg').Client} client
 */
async function releaseClient(client) {
  await client.end();
}

module.exports = { isDbConfigured, createClient, releaseClient };
