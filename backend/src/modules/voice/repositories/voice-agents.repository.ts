// src/modules/voice/repositories/voice-agents.repository.ts
import type { VoiceAgent } from '../../../types/voice.js';
import { pool, withTenant } from '../../../lib/db.js';

/**
 * Pre-tenant lookup for voice tenant resolution.
 * Used BEFORE tenant is known, so this must not require tenantId.
 */
export async function findAgentById(agentId: string): Promise<VoiceAgent | null> {
  const result = await pool.query<VoiceAgent>(
    `
    SELECT *
    FROM voice_agents
    WHERE id = $1
    LIMIT 1
    `,
    [agentId],
  );

  return result.rows[0] ?? null;
}

/**
 * Pre-tenant lookup for voice tenant resolution.
 * Used BEFORE tenant is known, so this must not require tenantId.
 */
export async function findAgentByProviderAgentId(
  providerAgentId: string,
): Promise<VoiceAgent | null> {
  const result = await pool.query<VoiceAgent>(
    `
    SELECT *
    FROM voice_agents
    WHERE provider_agent_id = $1
    LIMIT 1
    `,
    [providerAgentId],
  );

  return result.rows[0] ?? null;
}

/**
 * Tenant-aware lookup for already resolved tenant flows.
 */
export async function findAgentByIdForTenant(
  tenantId: string,
  agentId: string,
): Promise<VoiceAgent | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceAgent>(
      `
      SELECT *
      FROM voice_agents
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, agentId],
    );

    return result.rows[0] ?? null;
  });
}

/**
 * Tenant-aware lookup for already resolved tenant flows.
 */
export async function findAgentByProviderAgentIdForTenant(
  tenantId: string,
  providerAgentId: string,
): Promise<VoiceAgent | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceAgent>(
      `
      SELECT *
      FROM voice_agents
      WHERE tenant_id = $1
        AND provider_agent_id = $2
      LIMIT 1
      `,
      [tenantId, providerAgentId],
    );

    return result.rows[0] ?? null;
  });
}

export async function listAgentsByTenantId(
  tenantId: string,
): Promise<VoiceAgent[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<VoiceAgent>(
      `
      SELECT *
      FROM voice_agents
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      `,
      [tenantId],
    );

    return result.rows;
  });
}

export async function createAgent(
  data: Omit<VoiceAgent, 'id' | 'created_at' | 'updated_at'>,
): Promise<VoiceAgent> {
  return withTenant(data.tenant_id, async (client) => {
    const result = await client.query<VoiceAgent>(
      `
      INSERT INTO voice_agents (
        tenant_id,
        voice_provider_id,
        provider_agent_id,
        name,
        status,
        track_scope
      )
      VALUES (
        $1, $2, $3, $4, $5, $6
      )
      RETURNING *
      `,
      [
        data.tenant_id,
        data.voice_provider_id,
        data.provider_agent_id,
        data.name,
        data.status,
        data.track_scope,
      ],
    );

    return result.rows[0]!;
  });
}

export async function updateAgent(
  tenantId: string,
  agentId: string,
  data: Partial<
    Pick<
      VoiceAgent,
      | 'name'
      | 'status'
      | 'track_scope'
      | 'provider_agent_id'
      | 'voice_provider_id'
    >
  >,
): Promise<VoiceAgent> {
  return withTenant(tenantId, async (client) => {
    const existing = await client.query<VoiceAgent>(
      `
      SELECT *
      FROM voice_agents
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, agentId],
    );

    const current = existing.rows[0];
    if (!current) {
      throw new Error(`Voice agent not found: ${agentId}`);
    }

    const result = await client.query<VoiceAgent>(
      `
      UPDATE voice_agents
      SET
        voice_provider_id = $3,
        provider_agent_id = $4,
        name = $5,
        status = $6,
        track_scope = $7,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
      `,
      [
        tenantId,
        agentId,
        data.voice_provider_id ?? current.voice_provider_id,
        data.provider_agent_id ?? current.provider_agent_id,
        data.name ?? current.name,
        data.status ?? current.status,
        data.track_scope ?? current.track_scope,
      ],
    );

    return result.rows[0]!;
  });
}