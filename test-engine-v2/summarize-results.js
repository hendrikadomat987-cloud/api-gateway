'use strict';

/**
 * summarize-results.js
 *
 * Reads Jest JSON output and prints a compact, decision-friendly summary.
 *
 * Exports:
 *   summarize(jsonFilePath, opts) → exitCode (0 = all passed, 1 = failures)
 *
 * Direct invocation:
 *   node summarize-results.js [jsonFile] [--debug]
 *
 *   jsonFile defaults to .tmp/jest-output.json (relative to this script).
 *   --debug  also dumps captured console output from each test file.
 */

const fs   = require('fs');
const path = require('path');

// ─── Colours (no deps) ───────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
};

const ok     = s => `${c.green}${s}${c.reset}`;
const fail   = s => `${c.red}${s}${c.reset}`;
const dim    = s => `${c.dim}${s}${c.reset}`;
const bold   = s => `${c.bold}${s}${c.reset}`;
const cyan   = s => `${c.cyan}${s}${c.reset}`;
const yellow = s => `${c.yellow}${s}${c.reset}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns "x/y <unit>" coloured green when all pass, red otherwise.
 * unit defaults to 'passed' for per-category rows.
 */
function ratio(passed, total, unit = 'passed') {
  if (total === 0) return dim('–');
  const label = `${passed}/${total} ${unit}`;
  return passed === total ? ok(label) : fail(label);
}

/**
 * Classify a test file path into { service, category }.
 *
 *   services/customers/customers.crud.test.js      → { service: 'customers',     category: 'crud'           }
 *   services/appointments/appointments.rls.test.js → { service: 'appointments',  category: 'rls'            }
 *   scenarios/full-flow.test.js                    → { service: 'scenarios',     category: 'full-flow'      }
 */
function classify(filePath) {
  if (!filePath) return { service: 'other', category: 'unknown' };
  const norm = filePath.replace(/\\/g, '/');

  const scenarioMatch = norm.match(/scenarios\/([^/]+)\.test\.js$/);
  if (scenarioMatch) return { service: 'scenarios', category: scenarioMatch[1] };

  const serviceMatch = norm.match(/services\/([^/]+)\/[^/]+\.(crud|gateway|rls)\.test\.js$/);
  if (serviceMatch) return { service: serviceMatch[1], category: serviceMatch[2] };

  // Fallback — keeps unknown files out of the "other" bucket with a meaningful label
  const base = path.basename(filePath, '.test.js');
  return { service: 'other', category: base };
}

/**
 * Extract a short, grouped failure pattern from a test failure.
 * Order matters — more specific patterns must come before generic ones.
 */
function extractPattern(fullName, failureMessages) {
  const text = (failureMessages || []).join('\n') + '\n' + fullName;

  if (/401|MISSING_TOKEN|UNAUTHORIZED/i.test(text))               return '401 MISSING_TOKEN / Unauthorized';
  if (/403|FORBIDDEN/i.test(text))                                 return '403 FORBIDDEN';
  if (/404|not found|route not found/i.test(text))                 return '404 Not Found / Route Missing';
  if (/400|VALIDATION_ERROR|validation/i.test(text))              return '400 Validation Error';
  if (/INVALID_ID|invalid.*uuid|must be a uuid/i.test(text))      return 'INVALID_ID / UUID mismatch';
  if (/schema mismatch|unexpected.*field|extra.*field/i.test(text)) return 'Schema mismatch';
  if (/500|internal server error/i.test(text))                     return '500 Internal Server Error';
  if (/ECONNREFUSED|ENOTFOUND|network|timeout/i.test(text))       return 'Network / Connection error';
  if (/RLS|row.level.security/i.test(text))                        return 'RLS policy violation';
  if (/token|jwt|Bearer/i.test(text))                              return 'Auth / Token error';

  const firstLine = (failureMessages[0] || '').split('\n').find(l => l.trim());
  if (firstLine) return firstLine.trim().slice(0, 80);
  return 'Unknown failure';
}

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Read jest-output.json at jsonFile and print a compact summary.
 * Returns 0 if all tests passed, 1 otherwise.
 */
function summarize(jsonFile, opts = {}) {
  const { debug = false } = opts;

  // ── Load JSON ──────────────────────────────────────────────────────────────
  if (!fs.existsSync(jsonFile)) {
    console.error(fail(`\nError: Jest JSON output not found at ${jsonFile}`));
    console.error(dim('  Run:  npm run test:summary  (or pass a path as the first argument)\n'));
    return 1;
  }

  let jestResult;
  try {
    jestResult = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  } catch (e) {
    console.error(fail('\nError: Failed to parse Jest JSON output.'));
    console.error(dim(e.message));
    return 1;
  }

  // ── Aggregate per service/category ────────────────────────────────────────
  // groups[service][category] = { passed, total, failures[] }
  const groups          = {};
  const failurePatterns = new Map(); // pattern string → occurrence count

  for (const suite of jestResult.testResults) {
    const filePath = suite.testFilePath || suite.name;
    const { service, category } = classify(filePath);

    if (!groups[service])           groups[service]           = {};
    if (!groups[service][category]) groups[service][category] = { passed: 0, total: 0, failures: [] };

    const bucket = groups[service][category];

    for (const t of (suite.assertionResults || suite.testResults || [])) {
      bucket.total++;
      if (t.status === 'passed') {
        bucket.passed++;
      } else {
        bucket.failures.push({ name: t.fullName, messages: t.failureMessages });
        const pat = extractPattern(t.fullName, t.failureMessages);
        failurePatterns.set(pat, (failurePatterns.get(pat) || 0) + 1);
      }
    }
  }

  // ── Print per-service/category rows ───────────────────────────────────────
  const LINE   = dim('─'.repeat(56));
  const INDENT = '    ';

  console.log('');
  console.log(bold(cyan(' TEST SUMMARY')));
  console.log(LINE);

  const serviceNames    = Object.keys(groups).filter(s => s !== 'scenarios').sort();
  const orderedSections = [...serviceNames, groups['scenarios'] ? 'scenarios' : null].filter(Boolean);

  for (const service of orderedSections) {
    const isScenario = service === 'scenarios';
    const title      = isScenario
      ? 'Scenarios'
      : service.charAt(0).toUpperCase() + service.slice(1);

    console.log('');
    console.log(bold(` ${title}`));

    for (const category of Object.keys(groups[service]).sort()) {
      const { passed, total } = groups[service][category];
      const label = isScenario ? category : category.toUpperCase();
      const pad   = Math.max(0, 12 - label.length);
      console.log(`${INDENT}${dim(label)}${' '.repeat(pad)}${ratio(passed, total)}`);
    }
  }

  // ── Totals — sourced from Jest's authoritative top-level numbers ───────────
  // These are guaranteed correct even when suites crash or time out.
  const suitesTotal  = jestResult.numTotalTestSuites  ?? 0;
  const suitesPassed = jestResult.numPassedTestSuites ?? 0;
  const testsTotal   = jestResult.numTotalTests        ?? 0;
  const testsPassed  = jestResult.numPassedTests       ?? 0;
  const failCount    = testsTotal - testsPassed;

  console.log('');
  console.log(LINE);
  console.log(bold(' Totals'));
  console.log(`${INDENT}${ratio(suitesPassed, suitesTotal, 'suites passed')}`);
  console.log(`${INDENT}${ratio(testsPassed,  testsTotal,  'tests passed')}`);

  // ── Main blockers ──────────────────────────────────────────────────────────
  if (failCount === 0) {
    console.log('');
    console.log(ok('  All tests passed.'));
  } else {
    console.log('');
    console.log(bold(yellow(' Main blockers')));

    const sorted = [...failurePatterns.entries()].sort((a, b) => b[1] - a[1]);
    for (const [pat, count] of sorted) {
      const countStr = count > 1 ? fail(` ×${count}`) : '';
      console.log(`${INDENT}${dim('·')} ${pat}${countStr}`);
    }

    // Expanded failure list — only when small enough to stay scannable
    if (failCount <= 20) {
      console.log('');
      console.log(bold(' Failed tests'));
      for (const service of orderedSections) {
        for (const cat of Object.keys(groups[service]).sort()) {
          for (const { name } of groups[service][cat].failures) {
            console.log(`${INDENT}${dim(`[${service}/${cat}]`)} ${name}`);
          }
        }
      }
    }
  }

  console.log('');
  console.log(LINE);
  console.log(dim(`  Full output: npm run test:debug  |  JSON: ${path.relative(process.cwd(), jsonFile)}`));
  console.log('');

  // ── Debug: dump captured console output ───────────────────────────────────
  if (debug) {
    const hasConsole = jestResult.testResults.some(s => s.console?.length);
    if (hasConsole) {
      console.log(bold('\n──── CAPTURED CONSOLE OUTPUT ────'));
      for (const suite of jestResult.testResults) {
        if (!suite.console?.length) continue;
        console.log(dim(`\n[${path.basename(suite.testFilePath || suite.name || 'unknown')}]`));
        for (const entry of suite.console) {
          console.log(`  ${entry.message}`);
        }
      }
      console.log('');
    }
  }

  return jestResult.success ? 0 : 1;
}

// ─── Direct invocation ────────────────────────────────────────────────────────
if (require.main === module) {
  const args      = process.argv.slice(2);
  const debugMode = args.includes('--debug');
  const jsonArg   = args.find(a => !a.startsWith('--'));
  const jsonFile  = jsonArg
    ? path.resolve(jsonArg)
    : path.resolve(__dirname, '.tmp', 'jest-output.json');

  process.exit(summarize(jsonFile, { debug: debugMode }));
}

module.exports = { summarize };
