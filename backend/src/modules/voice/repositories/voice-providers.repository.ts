import type { VoiceProviderRecord } from '../../../types/voice.js';
import { withTenant } from '../../../lib/db.js';

/**
 * Reads the active voice provider for a tenant.
 * Query runs inside tenant-scoped DB context so RLS applies.
 */
export async function findProviderByTenantId(
  tenantId: string,
): Promise<VoiceProviderRecord | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceProviderRecord>(
      `
      SELECT *
      FROM voice_providers
      WHERE tenant_id = $1
        AND status = 'active'
      ORDER BY created_at ASC
      LIMIT 1
      `,
      [tenantId],
    );

    return result.rows[0] ?? null;
  });
}