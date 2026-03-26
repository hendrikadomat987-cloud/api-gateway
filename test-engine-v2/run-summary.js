'use strict';

/**
 * run-summary.js
 *
 * Cross-platform wrapper: runs Jest in JSON mode, then prints a compact summary.
 * Replaces the Unix-only `jest ... 2>/dev/null; node summarize-results.js` approach.
 *
 * Usage:
 *   node run-summary.js [jestPattern] [--debug]
 *
 *   jestPattern   optional path pattern forwarded to Jest (e.g. "services/customers")
 *   --debug       show Jest's live output AND print the compact summary afterwards
 */

'use strict';

const { spawnSync } = require('child_process');
const path          = require('path');
const fs            = require('fs');

// ─── CLI args ────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const debugMode = args.includes('--debug');
const pattern   = args.find(a => !a.startsWith('--')) || null;

// ─── Output file ─────────────────────────────────────────────────────────────
// Store under .tmp/ so it never clutters the working tree.
// The directory is created on demand; .tmp/ is listed in .gitignore.
const tmpDir  = path.join(__dirname, '.tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const outFile = path.join(tmpDir, 'jest-output.json');

// ─── Jest entrypoint ─────────────────────────────────────────────────────────
// Use Jest's JS entrypoint directly via process.execPath (the current Node binary).
// This avoids spawning .cmd shims on Windows, which triggers EINVAL in spawnSync.
// Works identically on POSIX: `node node_modules/jest/bin/jest.js`.
const jestJs = path.join(__dirname, 'node_modules', 'jest', 'bin', 'jest.js');

if (!fs.existsSync(jestJs)) {
  console.error(`\nCould not find Jest at ${jestJs}`);
  console.error('Run  npm install  inside test-engine-v2/ first.\n');
  process.exit(1);
}

// ─── Jest arguments ───────────────────────────────────────────────────────────
const jestArgs = [
  '--json',
  `--outputFile=${outFile}`,
  // --forceExit is intentional: the API client (axios) keeps HTTP sockets open
  // after tests finish. Without this flag Jest hangs waiting for the event loop
  // to drain, which can add 30+ seconds to every summary run.
  '--forceExit',
];

// --silent suppresses console.log calls inside test files.
// Only apply in summary mode — debug mode shows everything.
if (!debugMode) {
  jestArgs.push('--silent');
}

if (pattern) {
  jestArgs.push(pattern);
}

// ─── Run Jest ─────────────────────────────────────────────────────────────────
if (!debugMode) {
  process.stdout.write(`\nRunning tests${pattern ? ` [${pattern}]` : ''}...\n`);
}

// Summary mode: pipe (discard) Jest's reporter output — the JSON file has everything.
// Debug mode: inherit so Jest output prints live, then the compact summary follows.
const jestStdio = debugMode
  ? ['inherit', 'inherit', 'inherit']
  : ['ignore',  'pipe',    'pipe'];

const jestRun = spawnSync(process.execPath, [jestJs, ...jestArgs], {
  stdio: jestStdio,
  cwd:   __dirname,
});

if (jestRun.error) {
  console.error(`\nFailed to launch Jest: ${jestRun.error.message}\n`);
  process.exit(1);
}

// ─── Summarize ────────────────────────────────────────────────────────────────
const { summarize } = require('./summarize-results');
const exitCode = summarize(outFile, { debug: debugMode });
process.exit(exitCode);
