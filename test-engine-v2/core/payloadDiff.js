'use strict';

/**
 * payloadDiff — compact structural diff between two webhook payloads.
 *
 * PURPOSE
 * -------
 * When a REAL Vapi fixture is loaded alongside its PLACEHOLDER counterpart,
 * this helper reports structural differences: extra/missing fields and type mismatches.
 * It does NOT compare values — only field presence and JavaScript types.
 *
 * SCOPE
 * -----
 * - Recurses up to MAX_DEPTH levels (default 3) — covers the Vapi envelope shape
 * - Arrays are treated as leaves: compared by type + length, not by element content
 * - Objects beyond MAX_DEPTH are treated as leaves (compared as "object")
 *
 * This is intentionally lightweight — not a full JSON diff engine.
 */

const MAX_DEPTH = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flatten an object to a map of { "dot.notation.path": value }.
 * Arrays and depth-exceeded objects are treated as leaves.
 *
 * @param {*}      obj    - value to flatten
 * @param {string} prefix - current dot-path (empty for root)
 * @param {number} depth  - current recursion depth
 * @returns {Record<string, *>}
 */
function flattenPaths(obj, prefix = '', depth = 0) {
  // Treat as leaf: primitives, null, arrays, or objects beyond depth limit
  if (
    obj === null ||
    typeof obj !== 'object' ||
    Array.isArray(obj) ||
    depth > MAX_DEPTH
  ) {
    return prefix ? { [prefix]: obj } : {};
  }

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    Object.assign(out, flattenPaths(v, path, depth + 1));
  }
  return out;
}

/**
 * Return a human-readable type label for a value.
 * Arrays include their length: "array[3]".
 *
 * @param {*} val
 * @returns {string}
 */
function typeLabel(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return `array[${val.length}]`;
  return typeof val;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compare two payloads and return a compact structural diff.
 *
 * @param {object} real        - real Vapi payload (from fixtures/voice/live/real/)
 * @param {object} placeholder - placeholder fixture (from fixtures/voice/live/)
 * @returns {{
 *   fieldsOnlyInReal:        string[],
 *   fieldsOnlyInPlaceholder: string[],
 *   fieldsWithDifferentTypes: string[],
 * }}
 */
function diffPayloads(real, placeholder) {
  const realFlat = flattenPaths(real);
  const phFlat   = flattenPaths(placeholder);

  const realKeys = new Set(Object.keys(realFlat));
  const phKeys   = new Set(Object.keys(phFlat));

  const fieldsOnlyInReal        = [...realKeys].filter((k) => !phKeys.has(k)).sort();
  const fieldsOnlyInPlaceholder = [...phKeys].filter((k) => !realKeys.has(k)).sort();

  const fieldsWithDifferentTypes = [];
  for (const key of [...realKeys].sort()) {
    if (!phKeys.has(key)) continue;
    const rt = typeLabel(realFlat[key]);
    const pt = typeLabel(phFlat[key]);
    if (rt !== pt) {
      fieldsWithDifferentTypes.push(`${key} (real: ${rt} | placeholder: ${pt})`);
    }
  }

  return { fieldsOnlyInReal, fieldsOnlyInPlaceholder, fieldsWithDifferentTypes };
}

/**
 * Format a diff result as a compact, readable multi-line string.
 *
 * @param {string} fixtureName - e.g. 'vapi-status-update.json'
 * @param {ReturnType<diffPayloads>} diff
 * @returns {string}
 */
function formatDiff(fixtureName, diff) {
  const { fieldsOnlyInReal: onlyReal, fieldsOnlyInPlaceholder: onlyPh, fieldsWithDifferentTypes: typeM } = diff;
  const lines = [`[fixture-diff] ${fixtureName}`];

  if (onlyReal.length === 0 && onlyPh.length === 0 && typeM.length === 0) {
    lines.push('  → Shapes match — no structural differences detected.');
    return lines.join('\n');
  }

  if (onlyReal.length > 0) {
    lines.push(`  onlyInReal        (${onlyReal.length}): ${JSON.stringify(onlyReal)}`);
  }
  if (onlyPh.length > 0) {
    lines.push(`  onlyInPlaceholder (${onlyPh.length}): ${JSON.stringify(onlyPh)}`);
  }
  if (typeM.length > 0) {
    lines.push(`  typeMismatches    (${typeM.length}): ${JSON.stringify(typeM)}`);
  }

  return lines.join('\n');
}

module.exports = { diffPayloads, formatDiff };
