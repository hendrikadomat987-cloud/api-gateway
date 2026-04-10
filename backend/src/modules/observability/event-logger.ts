// src/modules/observability/event-logger.ts
//
// Append-only runtime event logger.
//
// All writes are fire-and-forget: logRuntimeEvent() returns void and never
// rejects — a logging failure must never block or crash a voice request.
//
// trace_id is read automatically from AsyncLocalStorage (set by the voice
// webhook controller for every incoming request).

import { pool } from '../../lib/db.js';
import { getTraceId } from '../../lib/trace.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RuntimeEventType =
  | 'tool.success'
  | 'tool.error'
  | 'tool.timeout'
  | 'feature.blocked'
  | 'limit.blocked'
  | 'limit.allowed';

export type RuntimeEventResult = 'success' | 'error' | 'blocked' | 'allowed';

export interface RuntimeEventInput {
  tenantId:    string;
  /** Defaults to the AsyncLocalStorage trace ID. Override for background jobs. */
  traceId?:    string;
  eventType:   RuntimeEventType;
  toolName?:   string;
  featureKey?: string;
  result:      RuntimeEventResult;
  errorCode?:  string;
  latencyMs?:  number;
  payload?:    Record<string, unknown>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: schedules a runtime event insert and returns immediately.
 * Never throws — any DB error is silently swallowed so it cannot block callers.
 */
export function logRuntimeEvent(event: RuntimeEventInput): void {
  _insert(event).catch(() => undefined);
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function _insert(event: RuntimeEventInput): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO voice_runtime_events
         (tenant_id, trace_id, event_type, tool_name, feature_key,
          result, error_code, latency_ms, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        event.tenantId,
        event.traceId ?? getTraceId(),
        event.eventType,
        event.toolName   ?? null,
        event.featureKey ?? null,
        event.result,
        event.errorCode  ?? null,
        event.latencyMs  ?? null,
        JSON.stringify(event.payload ?? {}),
      ],
    );
  } finally {
    client.release();
  }
}
