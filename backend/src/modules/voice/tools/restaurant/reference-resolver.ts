// src/modules/voice/tools/restaurant/reference-resolver.ts
//
// Deterministic reference resolution for conversational order inputs.
// Translates spoken references ("die zweite", "nochmal", "margherita")
// into concrete ContextItem lookups — no LLM, no guessing.

import type { OrderItemModifier } from '../../../../types/voice.js';

// ── Shared ContextItem type ───────────────────────────────────────────────────
// Single source of truth — imported by all order tool files.

export interface ContextItem {
  order_item_id: string | null;
  item_id:       string;
  menu_item_id:  string | null;
  name:          string;
  quantity:      number;
  unit_price:    number;
  modifiers:     OrderItemModifier[];
  line_total:    number;
}

// ── Result type ───────────────────────────────────────────────────────────────

export type ReferenceResolveType =
  | 'positional'   // "die zweite", "3."
  | 'last'         // "das letzte"
  | 'nochmal'      // "nochmal", "noch eins"
  | 'name'         // "margherita"
  | 'exact_id';    // UUID / order_item_id — caller handles directly

export interface ReferenceResult {
  type:    ReferenceResolveType;
  index:   number;           // 0-based index into items; -1 = unresolved
  item:    ContextItem | null;
  error?:  'item_not_found' | 'ambiguous_reference' | 'empty_order' | 'out_of_bounds';
}

// ── UUID detection ────────────────────────────────────────────────────────────

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// ── "nochmal" detection ───────────────────────────────────────────────────────

const NOCHMAL_PATTERN = /\b(nochmal|noch\s+ein(s|mal|e[ns]?)?\b|das\s+gleiche|dasselbe)\b/i;

export function isNochmalRef(ref: string): boolean {
  return NOCHMAL_PATTERN.test(ref);
}

// ── Positional detection ──────────────────────────────────────────────────────

// Returns 0-based index, or null if not a positional reference.
const ORDINALS: Array<[RegExp, number]> = [
  [/\berste[nrsm]?\b/i,                     0],
  [/\bzweite[nrsm]?\b/i,                    1],
  [/\bdritte[nrsm]?\b/i,                    2],
  [/\bvierte[nrsm]?\b/i,                    3],
  [/\bf[üu]nfte[nrsm]?\b/i,                 4],
  [/\bsechste[nrsm]?\b/i,                   5],
  [/\bsieb(?:te|ente)[nrsm]?\b/i,           6],
  [/\bachte[nrsm]?\b/i,                     7],
  [/\bneunte[nrsm]?\b/i,                    8],
  [/\bzehnte[nrsm]?\b/i,                    9],
];

function detectPositionalIndex(ref: string): number | 'last' | null {
  // "letzte" → last
  if (/\bletzte[nrsm]?\b/i.test(ref)) return 'last';

  // Pure digit or digit with dot: "1", "2.", "3"
  const numMatch = ref.trim().match(/^(\d+)\.?$/);
  if (numMatch) return parseInt(numMatch[1], 10) - 1;

  // German ordinal adjectives
  for (const [pattern, idx] of ORDINALS) {
    if (pattern.test(ref)) return idx;
  }

  return null;
}

// ── Name-based fuzzy matching ─────────────────────────────────────────────────

/**
 * Returns all items whose name contains the query (case-insensitive).
 * Returns empty array when nothing matches.
 */
export function findItemsByName(items: ContextItem[], query: string): ContextItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return items.filter((item) => item.name.toLowerCase().includes(q));
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Resolves a free-text reference to a concrete ContextItem.
 *
 * Priority order:
 *   1. UUID / order_item_id  → type:'exact_id' (caller handles via existing logic)
 *   2. "nochmal"             → type:'nochmal', last item
 *   3. Ordinals / "letzte"   → type:'positional' or 'last'
 *   4. Name fuzzy match      → type:'name'
 *
 * Never guesses silently — returns error codes for ambiguous or missing refs.
 */
export function resolveItemReference(
  items: ContextItem[],
  ref: string,
): ReferenceResult {
  // 1. UUID → let caller handle via its existing exact-match flow
  if (isUuid(ref)) {
    return { type: 'exact_id', index: -1, item: null };
  }

  if (items.length === 0) {
    return { type: 'positional', index: -1, item: null, error: 'empty_order' };
  }

  // 2. "nochmal" → duplicate last item
  if (isNochmalRef(ref)) {
    const last = items[items.length - 1];
    return { type: 'nochmal', index: items.length - 1, item: last };
  }

  // 3. Positional / "letzte"
  const positional = detectPositionalIndex(ref);
  if (positional !== null) {
    if (positional === 'last') {
      const last = items[items.length - 1];
      return { type: 'last', index: items.length - 1, item: last };
    }
    // Numeric position
    if (positional < 0 || positional >= items.length) {
      return { type: 'positional', index: -1, item: null, error: 'out_of_bounds' };
    }
    return { type: 'positional', index: positional, item: items[positional] };
  }

  // 4. Name-based fuzzy match
  const matches = findItemsByName(items, ref);

  if (matches.length === 0) {
    return { type: 'name', index: -1, item: null, error: 'item_not_found' };
  }

  // Check if all matches share the same name (→ not ambiguous, return last)
  const distinctNames = new Set(matches.map((m) => m.name.toLowerCase()));
  if (distinctNames.size > 1) {
    return { type: 'name', index: -1, item: null, error: 'ambiguous_reference' };
  }

  // All matches are the same item → return the last occurrence
  const lastMatch = matches[matches.length - 1];
  const lastIdx   = items.lastIndexOf(lastMatch);
  return { type: 'name', index: lastIdx, item: lastMatch };
}
