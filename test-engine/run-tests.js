'use strict';

/**
 * run-tests.js — entry point
 *
 * Auto-discovers every *.test.js file under /tests/ and runs each suite.
 * Exit code 0 = all pass, 1 = one or more failures.
 *
 * Usage:
 *   node run-tests.js
 *   node run-tests.js tests/customer/customer.crud.test.js   ← run a single file
 */

const path = require('path');
const fs   = require('fs');

// ── ANSI helpers (same approach as testRunner) ────────────────────────────────
const isTTY = process.stdout.isTTY;
const col   = (code, text) => isTTY ? `${code}${text}\x1b[0m` : text;
const BOLD  = '\x1b[1m';
const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const GREY  = '\x1b[90m';

// ── Discover test files ───────────────────────────────────────────────────────

function findTestFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files   = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(full);
    }
  }

  return files;
}

async function main() {
  // Support single-file override: node run-tests.js path/to/file.test.js
  const targeted = process.argv[2]
    ? [path.resolve(process.argv[2])]
    : findTestFiles(path.join(__dirname, 'tests'));

  if (targeted.length === 0) {
    console.log(col(GREY, 'No test files found in /tests/'));
    process.exit(0);
  }

  console.log(col(BOLD + CYAN, `\n╔══════════════════════════════════════════`));
  console.log(col(BOLD + CYAN, `║  API Gateway Test Engine`));
  console.log(col(BOLD + CYAN, `╚══════════════════════════════════════════`));
  console.log(col(GREY, `  Found ${targeted.length} test file(s)\n`));

  let totalPassed  = 0;
  let totalFailed  = 0;
  let totalSkipped = 0;
  const failedSuites = [];

  for (const filePath of targeted) {
    const suite = require(filePath);

    if (!suite || typeof suite.run !== 'function') {
      console.warn(col('\x1b[33m', `  ⚠ ${filePath} does not export a suite — skipping`));
      continue;
    }

    const result = await suite.run({});

    totalPassed  += result.passed;
    totalFailed  += result.failed;
    totalSkipped += result.skipped || 0;

    if (result.failed > 0) failedSuites.push(suite.name || filePath);
  }

  // ── Global summary ────────────────────────────────────────────────────────
  const allPassed = totalFailed === 0;

  console.log(col(BOLD + CYAN, `╔══════════════════════════════════════════`));
  console.log(col(BOLD + CYAN, `║  Final Results`));
  console.log(col(BOLD + CYAN, `╚══════════════════════════════════════════`));
  console.log(
    '  ' +
    col(GREEN,  `${totalPassed} passed`) + '  ' +
    (totalFailed  ? col(RED,    `${totalFailed} failed`)   + '  ' : '') +
    (totalSkipped ? col('\x1b[33m', `${totalSkipped} skipped`) + '  ' : '') +
    col(GREY,   `(${totalPassed + totalFailed + totalSkipped} total)`)
  );

  if (!allPassed) {
    console.log(col(RED, `\n  Failed suites:`));
    for (const name of failedSuites) {
      console.log(col(RED, `    • ${name}`));
    }
  }

  console.log('');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Unexpected runner error:', err);
  process.exit(1);
});
