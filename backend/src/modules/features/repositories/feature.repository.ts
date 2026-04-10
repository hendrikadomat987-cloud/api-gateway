// src/modules/features/repositories/feature.repository.ts
//
// Direct DB access for the Feature System V1.
// tenant_features is RLS-protected; all queries run via withTenant().
// domains/features/domain_features are global catalogues (no RLS).

import { withTenant, pool } from '../../../lib/db.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TenantFeatureRow {
  feature_key: string;
  is_enabled:  boolean;
  source:      string;
}

export interface TenantDomainRow {
  domain_key: string;
  is_enabled: boolean;
}

// ── Tenant-scoped queries ─────────────────────────────────────────────────────

/**
 * Returns all ENABLED feature keys for a tenant.
 * Used by the feature gate in resolve-tool.ts — called once per dispatch.
 *
 * Phase-2 note — domain-disable inconsistency:
 *   This query checks tenant_features.is_enabled but does NOT join tenant_domains.
 *   If a domain is disabled via tenant_domains.is_enabled = false, its features
 *   remain accessible as long as their tenant_features rows have is_enabled = true.
 *   The /api/v1/features domains list correctly excludes the disabled domain, but
 *   the tool gate will still pass for that domain's features.
 *
 *   This inconsistency is acceptable in Phase 1 because no code path currently
 *   sets tenant_domains.is_enabled = false (provisioning is additive-only).
 *   When a Domain-Disable admin feature is introduced in Phase 2, this query
 *   must be updated to also filter by tenant_domains.is_enabled = true.
 */
export async function getTenantFeatureKeys(tenantId: string): Promise<string[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<{ feature_key: string }>(
      `SELECT f.key AS feature_key
       FROM tenant_features tf
       JOIN features f ON f.id = tf.feature_id
       WHERE tf.tenant_id = $1
         AND tf.enabled   = true
       ORDER BY f.key`,
      [tenantId],
    );
    return result.rows.map((r) => r.feature_key);
  });
}

/**
 * Checks whether a single feature is enabled for a tenant.
 * Prefer getTenantFeatureKeys() when checking multiple features at once.
 */
export async function hasTenantFeature(tenantId: string, featureKey: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM tenant_features tf
         JOIN features f ON f.id = tf.feature_id
         WHERE tf.tenant_id = $1
           AND f.key        = $2
           AND tf.enabled   = true
       ) AS exists`,
      [tenantId, featureKey],
    );
    return result.rows[0]?.exists ?? false;
  });
}

/**
 * Returns all enabled domains for a tenant.
 */
export async function getTenantDomainKeys(tenantId: string): Promise<string[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<{ domain_key: string }>(
      `SELECT d.key AS domain_key
       FROM tenant_domains td
       JOIN domains d ON d.id = td.domain_id
       WHERE td.tenant_id  = $1
         AND td.enabled_at IS NOT NULL
       ORDER BY d.key`,
      [tenantId],
    );
    return result.rows.map((r) => r.domain_key);
  });
}

// ── Provisioning ──────────────────────────────────────────────────────────────

/**
 * Idempotently provisions a domain for a tenant.
 *
 * Steps:
 *   1. Resolve domain_id from domain_key.
 *   2. Upsert tenant_domains row (ON CONFLICT DO NOTHING).
 *   3. For each feature in domain_features, upsert tenant_features row
 *      with source = 'domain_provisioned' (ON CONFLICT DO NOTHING).
 *
 * Safe to call multiple times — existing rows are never downgraded or removed.
 *
 * Voice rule: Every voice-capable tenant needs 'voice.core' and 'voice.callback'.
 * These are seeded under the 'voice' domain in domain_features. This function
 * does NOT inject 'voice' automatically — the caller must include it explicitly.
 * Standard pattern for a new voice tenant with a specific domain:
 *   await provisionTenantDomain(tenantId, 'voice');
 *   await provisionTenantDomain(tenantId, 'salon');   // or 'booking', 'restaurant'
 *
 * JavaScript equivalent (for seed scripts): lib/provision-tenant-domains.js
 */
export async function provisionTenantDomain(
  tenantId: string,
  domainKey: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    // 1. Resolve domain
    const domainRes = await client.query<{ id: string }>(
      `SELECT id FROM domains WHERE domain_key = $1 AND is_active = true`,
      [domainKey],
    );
    if (domainRes.rows.length === 0) {
      throw new Error(`Feature provisioning: unknown domain '${domainKey}'`);
    }
    const domainId = domainRes.rows[0].id;

    // 2. Upsert tenant_domain
    await client.query(
      `INSERT INTO tenant_domains (tenant_id, domain_id, is_enabled)
       VALUES ($1, $2, true)
       ON CONFLICT (tenant_id, domain_id) DO NOTHING`,
      [tenantId, domainId],
    );

    // 3. Upsert tenant_features for every feature in this domain
    const featuresRes = await client.query<{ feature_id: string }>(
      `SELECT feature_id FROM domain_features WHERE domain_id = $1`,
      [domainId],
    );
    for (const row of featuresRes.rows) {
      await client.query(
        `INSERT INTO tenant_features (tenant_id, feature_id, is_enabled, source)
         VALUES ($1, $2, true, 'domain_provisioned')
         ON CONFLICT (tenant_id, feature_id) DO NOTHING`,
        [tenantId, row.feature_id],
      );
    }
  });
}

// ── Global catalogue (no tenant context needed) ───────────────────────────────

/**
 * Returns all active domains from the global catalogue.
 * Used by admin/seed tooling — does not require tenant context.
 */
export async function listAllDomains(): Promise<Array<{ domain_key: string; name: string }>> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ domain_key: string; name: string }>(
      `SELECT domain_key, name FROM domains WHERE is_active = true ORDER BY domain_key`,
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Returns all active features from the global catalogue.
 * Used by admin/seed tooling — does not require tenant context.
 */
export async function listAllFeatures(): Promise<
  Array<{ feature_key: string; name: string; category: string }>
> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ feature_key: string; name: string; category: string }>(
      `SELECT feature_key, name, category FROM features WHERE is_active = true ORDER BY feature_key`,
    );
    return result.rows;
  } finally {
    client.release();
  }
}
