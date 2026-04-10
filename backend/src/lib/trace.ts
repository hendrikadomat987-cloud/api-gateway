// src/lib/trace.ts
//
// Lightweight trace-ID propagation using AsyncLocalStorage.
//
// The trace ID is set once at request entry (voice webhook or HTTP handler)
// and is automatically available throughout the entire async call chain —
// feature gating, usage tracking, tool execution — without threading it
// through every function signature.
//
// Usage:
//   // At request entry (middleware / controller):
//   traceStore.run(requestId, async () => { ... });
//
//   // Anywhere in the call chain:
//   const id = getTraceId();  // returns the active trace ID

import { AsyncLocalStorage } from 'node:async_hooks';

export const traceStore = new AsyncLocalStorage<string>();

/**
 * Returns the current trace ID, or 'untraced' when called outside a
 * traceStore.run() context (e.g. background jobs, tests without setup).
 */
export function getTraceId(): string {
  return traceStore.getStore() ?? 'untraced';
}
