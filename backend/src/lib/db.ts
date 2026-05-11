import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = new Pool({
  connectionString,
  // Keep well below Supabase pgBouncer's per-project limit (25).
  // 3 connections are enough; the pool queues additional requests.
  // A lower value leaves more headroom for test-side direct connections.
  max: 3,
  // Release idle connections quickly so pgBouncer resources are freed.
  idleTimeoutMillis: 10_000,
  // Don't wait forever for a free slot when all 5 are busy.
  connectionTimeoutMillis: 10_000,
  // Hard per-query timeout — prevents pgBouncer's 60s checkout_timeout
  // from blocking an HTTP request indefinitely when pgBouncer is saturated.
  // 20s gives enough headroom for slow queries under full-suite DB load
  // while still preventing indefinite hangs.
  query_timeout: 20_000,
  // Keep TCP connections alive — prevents silent network drops from
  // causing "Connection terminated unexpectedly" mid-request.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  // Required for Supabase's AWS-hosted pgBouncer endpoint.
  ssl: { rejectUnauthorized: false },
});

// Without this handler, pg emits an unhandled 'error' event when an idle
// client is severed by the server or a network drop, crashing the process.
pool.on('error', (err) => {
  // Log and discard — pg will evict the broken client and create a fresh one.
  // eslint-disable-next-line no-console
  console.error('[db] idle client error (pool will recover):', err.message);
});

/**
 * Runs a query with tenant context.
 * This is CRITICAL for RLS.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  // Absorb socket-level errors on the checked-out client so Node doesn't
  // crash with "Unhandled 'error' event".  pg emits this when pgBouncer
  // silently severs the TCP connection mid-transaction.  The in-flight
  // query still rejects the awaiting Promise through the catch block below.
  // We add and REMOVE the handler around the transaction so there is no
  // listener accumulation across pool reuse cycles (avoids MaxListeners warning).
  const clientErrHandler = (err: Error) => {
    // eslint-disable-next-line no-console
    console.error('[db] active client error (withTenant will handle via catch):', err.message);
  };
  (client as any).on('error', clientErrHandler);

  try {
    await client.query('BEGIN');

    // 🔴 CRITICAL: set tenant context for RLS
    await client.query(
      `SELECT set_config('app.current_tenant', $1, true)`,
      [tenantId],
    );

    const result = await fn(client);

    await client.query('COMMIT');

    return result;
  } catch (err) {
    // Best-effort rollback; ignore secondary error if the connection is dead.
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    (client as any).removeListener('error', clientErrHandler);
    client.release();
  }
}