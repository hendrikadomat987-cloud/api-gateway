'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',

  // Only pick up tests in the new service/scenario directories
  testMatch: [
    '<rootDir>/services/**/*.test.js',
    '<rootDir>/scenarios/**/*.test.js',
  ],

  // Each test file gets 30 s before Jest kills it
  testTimeout: 30_000,

  // Serial execution — prevents cross-test resource conflicts on the API
  maxWorkers: 1,

  // Human-readable output
  verbose: true,

  // Do NOT stop on first failure — collect the full picture
  bail: false,

  // Exclude superseded files (renamed or replaced by newer equivalents)
  testPathIgnorePatterns: [
    '/node_modules/',
    'appointments\\.gateway-security\\.test\\.js',
  ],

  // Show full error diffs
  errorOnDeprecated: true,
};
