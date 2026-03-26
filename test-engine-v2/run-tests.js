#!/usr/bin/env node
'use strict';

/**
 * run-tests.js
 *
 * Unified entry point that supports both the new Jest-based test engine
 * (services/ + scenarios/) and the legacy custom-runner tests (tests/).
 *
 * Usage:
 *   node run-tests.js                    # new Jest suite (services + scenarios)
 *   node run-tests.js --legacy           # old custom-runner tests in tests/
 *   node run-tests.js --ci               # Jest, serial, forceExit
 *   node run-tests.js --filter requests  # Jest, pattern filter
 *
 * npm scripts (from package.json):
 *   npm test               → Jest (all services + scenarios)
 *   npm run test:ci        → Jest serial + forceExit
 *   npm run test:customers → Jest customers only
 */

const path = require('path');
const http  = require('http');
const https = require('https');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// ── CLI args ──────────────────────────────────────────────────────────────────

const argv   = process.argv.slice(2);
const legacy = argv.includes('--legacy');
const ci     = argv.includes('--ci');
const filter = (() => {
  const i = argv.indexOf('--filter');
  return i !== -1 ? argv[i + 1] : null;
})();

// ── Connectivity check ────────────────────────────────────────────────────────

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api/v1';

function checkConnectivity(url) {
  return new Promise((resolve) => {
    const lib        = url.startsWith('https') ? https : http;
    const healthUrl  = url.replace(/\/api\/v\d+\/?$/, '/api/health');
    const req = lib.get(healthUrl, { timeout: 5000 }, (res) => {
      resolve({ ok: res.statusCode < 500, status: res.statusCode });
    });
    req.on('error',   (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', ()  => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

// ── Legacy runner (tests/) ────────────────────────────────────────────────────

async function runLegacy() {
  const fs  = require('fs');

  function findTestFiles(dir) {
    const result = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) result.push(...findTestFiles(full));
      else if (entry.name.endsWith('.test.js')) result.push(full);
    }
    return result;
  }

  const files = findTestFiles(path.join(__dirname, 'tests'));
  if (!files.length) { console.log('No legacy test files found.'); return 0; }

  let passed = 0, failed = 0, skipped = 0;
  const failedSuites = [];

  for (const file of files) {
    const suite = require(file);
    if (!suite || typeof suite.run !== 'function') continue;
    const r = await suite.run({});
    passed  += r.passed;
    failed  += r.failed;
    skipped += r.skipped || 0;
    if (r.failed > 0) failedSuites.push(suite.name || file);
  }

  console.log(`\nLegacy results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failedSuites.length) console.log('Failed:', failedSuites.join(', '));
  return failed > 0 ? 1 : 0;
}

// ── Jest runner (services/ + scenarios/) ─────────────────────────────────────

async function runJest() {
  const { run } = require('jest');

  const testMatch = filter
    ? [`**/${filter}**/*.test.js`, `**/${filter}*.test.js`]
    : [
        '<rootDir>/services/**/*.test.js',
        '<rootDir>/scenarios/**/*.test.js',
      ];

  const jestConfig = {
    rootDir:     __dirname,
    testMatch,
    testTimeout: 30_000,
    maxWorkers:  1,
    verbose:     true,
    bail:        false,
    forceExit:   ci || true,    // always force-exit for API tests (open handles)
  };

  const ok = await run(jestConfig, __dirname);
  return ok ? 0 : 1;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const isTTY = process.stdout.isTTY;
  const line  = isTTY ? '\x1b[1m\x1b[36m' : '';
  const reset = isTTY ? '\x1b[0m' : '';

  console.log(`${line}${'═'.repeat(56)}${reset}`);
  console.log(`${line}  API Gateway Test Engine  ${legacy ? '(legacy mode)' : 'v2 (Jest)'}${reset}`);
  console.log(`${line}${'═'.repeat(56)}${reset}`);
  console.log(`  API URL : ${BASE_URL}`);
  if (filter) console.log(`  Filter  : ${filter}`);
  console.log('');

  process.stdout.write('  Checking API connectivity … ');
  const conn = await checkConnectivity(BASE_URL);
  if (conn.ok) {
    console.log(`OK (HTTP ${conn.status})\n`);
  } else {
    console.log(`WARN – ${conn.error || conn.status}`);
    console.log('  ⚠  Gateway unreachable; tests may fail.\n');
  }

  const exitCode = legacy ? await runLegacy() : await runJest();
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[run-tests] Fatal:', err.message);
  process.exit(1);
});
