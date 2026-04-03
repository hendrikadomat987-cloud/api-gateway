// src/modules/voice/repositories/voice-numbers.repository.ts
import type { VoiceNumber } from '../../../types/voice.js';
import { pool, withTenant } from '../../../lib/db.js';

/**
 * Pre-tenant lookup for voice tenant resolution.
 * Used BEFORE tenant is known, so this must not require tenantId.
 */
export async function findNumberByPhoneNumber(
  phoneNumber: string,
): Promise<VoiceNumber | null> {
  const result = await pool.query<VoiceNumber>(
    `
    SELECT *
    FROM voice_numbers
    WHERE phone_number = $1
    LIMIT 1
    `,
    [phoneNumber],
  );

  return result.rows[0] ?? null;
}

/**
 * Tenant-aware lookup for already resolved tenant flows.
 */
export async function findNumberById(
  tenantId: string,
  numberId: string,
): Promise<VoiceNumber | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceNumber>(
      `
      SELECT *
      FROM voice_numbers
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, numberId],
    );

    return result.rows[0] ?? null;
  });
}

/**
 * Tenant-aware lookup for already resolved tenant flows.
 */
export async function findNumberByPhoneNumberForTenant(
  tenantId: string,
  phoneNumber: string,
): Promise<VoiceNumber | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceNumber>(
      `
      SELECT *
      FROM voice_numbers
      WHERE tenant_id = $1
        AND phone_number = $2
      LIMIT 1
      `,
      [tenantId, phoneNumber],
    );

    return result.rows[0] ?? null;
  });
}

export async function listNumbersByTenantId(
  tenantId: string,
): Promise<VoiceNumber[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceNumber>(
      `
      SELECT *
      FROM voice_numbers
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      `,
      [tenantId],
    );

    return result.rows;
  });
}

export async function createNumber(
  data: Omit<VoiceNumber, 'id' | 'created_at' | 'updated_at'>,
): Promise<VoiceNumber> {
  return withTenant(data.tenant_id, async (client) => {
    const result = await client.query<VoiceNumber>(
      `
      INSERT INTO voice_numbers (
        tenant_id,
        voice_provider_id,
        voice_agent_id,
        phone_number,
        provider_number_id,
        status
      )
      VALUES (
        $1, $2, $3, $4, $5, $6
      )
      RETURNING *
      `,
      [
        data.tenant_id,
        data.voice_provider_id,
        data.voice_agent_id ?? null,
        data.phone_number,
        data.provider_number_id ?? null,
        data.status,
      ],
    );

    return result.rows[0]!;
  });
}

export async function updateNumber(
  tenantId: string,
  numberId: string,
  data: Partial<
    Pick<
      VoiceNumber,
      | 'voice_provider_id'
      | 'voice_agent_id'
      | 'phone_number'
      | 'provider_number_id'
      | 'status'
    >
  >,
): Promise<VoiceNumber> {
  return withTenant(tenantId, async (client) => {
    const existing = await client.query<VoiceNumber>(
      `
      SELECT *
      FROM voice_numbers
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, numberId],
    );

    const current = existing.rows[0];
    if (!current) {
      throw new Error(`Voice number not found: ${numberId}`);
    }

    const result = await client.query<VoiceNumber>(
      `
      UPDATE voice_numbers
      SET
        voice_provider_id = $3,
        voice_agent_id = $4,
        phone_number = $5,
        provider_number_id = $6,
        status = $7,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
      `,
      [
        tenantId,
        numberId,
        data.voice_provider_id ?? current.voice_provider_id,
        data.voice_agent_id ?? current.voice_agent_id ?? null,
        data.phone_number ?? current.phone_number,
        data.provider_number_id ?? current.provider_number_id ?? null,
        data.status ?? current.status,
      ],
    );

    return result.rows[0]!;
  });
}