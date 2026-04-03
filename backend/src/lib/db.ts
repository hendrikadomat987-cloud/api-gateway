import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = new Pool({
  connectionString,
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
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}