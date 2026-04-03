'use strict';

/**
 * Jest configuration for DB migration tests.
 *
 * Migration tests are kept in a separate Jest project so they can be
 * run independently from the API integration tests:
 *
 *   npm run test:migrations           # run all migration tests
 *   npm run test:migrations:schema    # structural checks only
 *   npm run test:migrations:rls       # RLS / policy checks only
 *   npm run test:migrations:smoke     # fresh-DB data-flow smoke
 *
 * Prerequisites:
 *   MIGRATION_TEST_DB_URL set in test-engine-v2/.env
 *   (tests skip cleanly with an explanatory message if the var is absent)
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',

  testMatch: ['<rootDir>/migrations/**/*.test.js'],

  // Migrations can be slow — give each file 60 s
  testTimeout: 60_000,

  // Serial — schema setup/teardown must not interleave
  maxWorkers: 1,

  verbose: true,

  // Collect the full picture — don't stop on first failure
  bail: false,
};
