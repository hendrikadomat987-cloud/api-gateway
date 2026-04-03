'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

/**
 * DB helper for voice integration tests.
 *
 * Requires VOICE_TEST_DB_URL in test-engine-v2/.env — this should be the
 * connection string for the running application database using a role that can
 * bypass RLS (i.e. superuser or a role with BYPASSRLS).
 *
 * When VOICE_TEST_DB_URL is not set, isDbConfigured() returns false and all
 * DB-dependent tests skip cleanly.
 *
 * Example .env entry:
 *   VOICE_TEST_DB_URL=postgresql://postgres:secret@localhost:5432/your_app_db
 */

const DB_URL = process.env.VOICE_TEST_DB_URL;

function isDbConfigured() {
  return !!DB_URL;
}

/**
 * Connect to the application DB.
 * @returns {Promise<import('pg').Client>}
 */
async function createClient() {
  if (!DB_URL) {
    throw new Error(
      'VOICE_TEST_DB_URL is not set.\n' +
      'Add it to test-engine-v2/.env to run DB-dependent voice tests.\n' +
      '\n' +
      'This should point to the application database (not a migration test DB).\n' +
      'The role must be a superuser or have BYPASSRLS to allow direct row updates.\n' +
      '\n' +
      'Example:\n' +
      '  VOICE_TEST_DB_URL=postgresql://postgres:secret@localhost:5432/your_app_db',
    );
  }

  const { Client } = require('pg');
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

/**
 * End a client connection.
 * @param {import('pg').Client} client
 */
async function releaseClient(client) {
  await client.end();
}

/**
 * Directly update a voice event's processing_status, bypassing RLS.
 * Requires a superuser connection.
 *
 * @param {import('pg').Client} client
 * @param {string} eventId
 * @param {'received'|'processed'|'failed'} status
 */
async function forceEventStatus(client, eventId, status) {
  const result = await client.query(
    'UPDATE voice_events SET processing_status = $2, processing_error_message = $3 WHERE id = $1 RETURNING id',
    [eventId, status, status === 'failed' ? 'forced-by-test' : null],
  );
  if (result.rowCount === 0) {
    throw new Error(`forceEventStatus: event ${eventId} not found in voice_events`);
  }
}

module.exports = { isDbConfigured, createClient, releaseClient, forceEventStatus };
