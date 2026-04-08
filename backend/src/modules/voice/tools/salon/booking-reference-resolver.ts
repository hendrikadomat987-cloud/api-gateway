// src/modules/voice/tools/salon/booking-reference-resolver.ts
//
// Deterministic reference resolution for conversational booking inputs.
// Translates spoken references ("die erste", "Schneiden", "bei Anna")
// into concrete ContextService lookups — no LLM, no guessing.

// ── Shared ContextService type ────────────────────────────────────────────────
// Single source of truth for all salon tool files.

export interface ContextService {
  booking_service_id: string | null; // DB row id in salon_booking_services
  item_id:            string;        // service_id from catalogue
  name:               string;
  duration_minutes:   number;
  unit_price:         number;        // euros
  price_cents:        number;
}

// ── Result type ───────────────────────────────────────────────────────────────

export type ReferenceResolveType =
  | 'positional'  // "die erste", "2."
  | 'last'        // "das letzte"
  | 'nochmal'     // "nochmal", "noch eins"
  | 'name'        // "Schneiden"
  | 'exact_id';   // UUID — caller handles directly

export interface ReferenceCandidate {
  position: number; // 1-based
  name:     string;
  id:       string;
}

export interface ReferenceResult {
  type:        ReferenceResolveType;
  index:       number;                // 0-based; -1 = unresolved
  item:        ContextService | null;
  error?:      'item_not_found' | 'ambiguous_reference' | 'empty_booking' | 'out_of_bounds';
  candidates?: ReferenceCandidate[];
}

// ── UUID detection ────────────────────────────────────────────────────────────

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// ── "Nochmal" detection ───────────────────────────────────────────────────────

const NOCHMAL_PATTERN = /\b(nochmal|noch\s+ein(s|mal|e[ns]?)?\b|das\s+gleiche|dasselbe)\b/i;

export function isNochmalRef(ref: string): boolean {
  return NOCHMAL_PATTERN.test(ref);
}

// ── Positional detection ──────────────────────────────────────────────────────

const ORDINALS: Array<[RegExp, number]> = [
  [/\berste[nrsm]?\b/i,             0],
  [/\bzweite[nrsm]?\b/i,            1],
  [/\bdritte[nrsm]?\b/i,            2],
  [/\bvierte[nrsm]?\b/i,            3],
  [/\bf[üu]nfte[nrsm]?\b/i,         4],
  [/\bsechste[nrsm]?\b/i,           5],
  [/\bsieb(?:te|ente)[nrsm]?\b/i,   6],
  [/\bachte[nrsm]?\b/i,             7],
  [/\bneunte[nrsm]?\b/i,            8],
  [/\bzehnte[nrsm]?\b/i,            9],
];

function detectPositionalIndex(ref: string): number | 'last' | null {
  if (/\bletzte[nrsm]?\b/i.test(ref)) return 'last';

  const numMatch = ref.trim().match(/^(\d+)\.?$/);
  if (numMatch) return parseInt(numMatch[1], 10) - 1;

  for (const [pattern, idx] of ORDINALS) {
    if (pattern.test(ref)) return idx;
  }
  return null;
}

// ── Name-based fuzzy matching ─────────────────────────────────────────────────

export function findServicesByName(
  services: ContextService[],
  query: string,
): ContextService[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return services.filter((s) => s.name.toLowerCase().includes(q));
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Resolves a free-text reference to a concrete ContextService.
 *
 * Priority:
 *   1. UUID            → 'exact_id' (caller handles)
 *   2. "nochmal"       → 'nochmal', clones last service
 *   3. Ordinals        → 'positional' / 'last'
 *   4. Name fuzzy      → 'name'
 *
 * Never guesses — returns explicit error codes for ambiguous/missing refs.
 */
export function resolveServiceReference(
  services: ContextService[],
  ref: string,
): ReferenceResult {
  if (isUuid(ref)) {
    return { type: 'exact_id', index: -1, item: null };
  }

  if (services.length === 0) {
    return { type: 'positional', index: -1, item: null, error: 'empty_booking' };
  }

  if (isNochmalRef(ref)) {
    const last = services[services.length - 1];
    return { type: 'nochmal', index: services.length - 1, item: last };
  }

  const positional = detectPositionalIndex(ref);
  if (positional !== null) {
    if (positional === 'last') {
      return { type: 'last', index: services.length - 1, item: services[services.length - 1] };
    }
    if (positional < 0 || positional >= services.length) {
      return { type: 'positional', index: -1, item: null, error: 'out_of_bounds' };
    }
    return { type: 'positional', index: positional, item: services[positional] };
  }

  // Name fuzzy match
  const matches = findServicesByName(services, ref);
  if (matches.length === 0) {
    return { type: 'name', index: -1, item: null, error: 'item_not_found' };
  }

  const distinctNames = new Set(matches.map((m) => m.name.toLowerCase()));
  if (distinctNames.size > 1) {
    const candidates: ReferenceCandidate[] = matches.map((m) => ({
      position: services.indexOf(m) + 1,
      name:     m.name,
      id:       m.booking_service_id ?? m.item_id,
    }));
    return { type: 'name', index: -1, item: null, error: 'ambiguous_reference', candidates };
  }

  const lastMatch = matches[matches.length - 1];
  const lastIdx   = services.lastIndexOf(lastMatch);
  return { type: 'name', index: lastIdx, item: lastMatch };
}
