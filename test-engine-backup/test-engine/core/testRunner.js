'use strict';

const config = require('../config');

// ANSI colour helpers (gracefully degrade on non-TTY)
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  grey:   '\x1b[90m',
};

const isTTY = process.stdout.isTTY;
const col   = (code, text) => isTTY ? `${code}${text}${c.reset}` : text;

// ── Suite factory ─────────────────────────────────────────────────────────────

/**
 * Creates a named test suite.
 *
 * @param {string} suiteName
 * @returns {{ test: Function, run: Function }}
 *
 * @example
 * const suite = createSuite('Customer CRUD');
 * suite.test('Create customer', async (ctx) => { ... }, { critical: true });
 * module.exports = suite;
 */
function createSuite(suiteName) {
  const registeredTests = [];

  /**
   * Register a single test.
   *
   * @param {string}   name       - Human-readable test name
   * @param {Function} fn         - async (ctx) => void  — throw to fail
   * @param {object}   [opts]
   * @param {boolean}  [opts.critical=false] - Stop entire suite on failure
   */
  function test(name, fn, opts = {}) {
    registeredTests.push({
      name,
      fn,
      critical: opts.critical === true,
    });
  }

  /**
   * Run all registered tests sequentially.
   * Returns a result summary and exits with code 1 if any test failed.
   *
   * @param {object} [sharedCtx={}] - Shared mutable context passed to every test fn
   * @returns {Promise<{ passed: number, failed: number, total: number }>}
   */
  async function run(sharedCtx = {}) {
    const results = [];
    let aborted   = false;

    console.log('');
    console.log(col(c.bold + c.cyan, `┌─ Suite: ${suiteName} (${registeredTests.length} tests)`));
    console.log('');

    for (const { name, fn, critical } of registeredTests) {
      if (aborted) {
        results.push({ name, status: 'SKIPPED', durationMs: 0, error: null });
        console.log(col(c.yellow, `  ⊘ SKIP`) + col(c.grey, `  ${name}`));
        continue;
      }

      const start = Date.now();
      try {
        await fn(sharedCtx);
        const durationMs = Date.now() - start;
        results.push({ name, status: 'PASS', durationMs, error: null });
        console.log(
          col(c.green,  `  ✔ PASS`) +
          col(c.grey,   `  ${name}`) +
          col(c.grey,   `  (${durationMs}ms)`)
        );
      } catch (err) {
        const durationMs = Date.now() - start;
        results.push({ name, status: 'FAIL', durationMs, error: err });
        console.log(
          col(c.red,   `  ✘ FAIL`) +
          col(c.grey,  `  ${name}`) +
          col(c.grey,  `  (${durationMs}ms)`)
        );
        console.log(col(c.red, `         ${err.message}`));

        if (critical && config.stopOnCritical) {
          console.log(col(c.yellow, `\n  ⚠ Critical test failed — stopping suite.`));
          aborted = true;
        }
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const passed  = results.filter((r) => r.status === 'PASS').length;
    const failed  = results.filter((r) => r.status === 'FAIL').length;
    const skipped = results.filter((r) => r.status === 'SKIPPED').length;
    const total   = results.length;

    console.log('');
    console.log(col(c.bold + c.cyan, `└─ Results: `) +
      col(c.green,  `${passed} passed`) + '  ' +
      (failed  ? col(c.red,    `${failed} failed`)  + '  ' : '') +
      (skipped ? col(c.yellow, `${skipped} skipped`) + '  ' : '') +
      col(c.grey, `(${total} total)`)
    );
    console.log('');

    return { passed, failed, skipped, total, results };
  }

  return { test, run, name: suiteName };
}

module.exports = { createSuite };
