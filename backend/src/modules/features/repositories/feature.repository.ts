// src/modules/features/repositories/feature.repository.ts
//
// Direct DB access for the Feature System V1 + V2 management layer.
// tenant_features / tenant_domains are RLS-protected; all writes use withTenant().
// domains / features / domain_features are global catalogues (no RLS).
//
// Actual DB schema (as deployed):
//   domains        — id, key, name, created_at
//   features       — id, key, created_at
//   domain_features— domain_id, feature_id
//   tenant_domains — id, tenant_id, domain_id, enabled_at (NULL = disabled)
//   tenant_features— id, tenant_id, feature_id, enabled (boolean)

import { withTenant, pool } from '../../../lib/db.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FeatureDetail {
  key:     string;
  enabled: boolean;
}

/** Extended detail with provenance — used by the verbose endpoint. */
export interface FeatureDetailWithSource {
  key:     string;
  enabled: boolean;
  /** 'plan' | 'override' | 'plan+override' */
  source:  string;
}

export interface DomainDetail {
  key:     string;
  name:    string;
  enabled: boolean;
}

// ── Read queries ──────────────────────────────────────────────────────────────

/**
 * Returns all ENABLED feature keys for a tenant.
 *
 * Resolution order (Phase 3):
 *   1. Plan-granted features — features in plan_features for the tenant's plan,
 *      provided the tenant has NOT explicitly disabled the feature
 *      (tenant_features.enabled=false wins over plan baseline).
 *   2. Manually enabled features — tenant_features.enabled=true
 *      (Phase-2 behaviour, no domain-consistency check required).
 *
 * If the tenant has no plan (no tenant_plans row), leg 1 returns 0 rows and
 * only leg 2 applies — identical to pre-Phase-3 behaviour.
 *
 * Used by the feature gate in resolve-tool.ts — called once per dispatch.
 */
export async function getTenantFeatureKeys(tenantId: string): Promise<string[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<{ feature_key: string }>(
      `SELECT DISTINCT feature_key
       FROM (
         -- Leg 1: Plan-granted features (in plan_features, not explicitly disabled)
         SELECT f.key AS feature_key
         FROM tenant_plans tp
         JOIN plan_features pf ON pf.plan_id = tp.plan_id
         JOIN features f ON f.id = pf.feature_id
         WHERE tp.tenant_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM tenant_features tf_o
             WHERE tf_o.tenant_id  = $1
               AND tf_o.feature_id = f.id
               AND tf_o.enabled    = false
           )

         UNION ALL

         -- Leg 2: Manually enabled features (tenant_features row with enabled=true)
         SELECT f.key AS feature_key
         FROM tenant_features tf
         JOIN features f ON f.id = tf.feature_id
         WHERE tf.tenant_id = $1
           AND tf.enabled   = true
       ) _combined
       ORDER BY feature_key`,
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
 * Returns all enabled domain keys for a tenant.
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

/**
 * Returns all ENABLED features with provenance source for a tenant.
 * Used by the verbose endpoint (Phase 3).
 *
 * source values:
 *   'plan'          — granted by the tenant's plan, no explicit tenant row
 *   'override'      — manually enabled via tenant_features (or explicitly disabled)
 *   'plan+override' — granted by plan AND has an explicit tenant_features.enabled=true row
 *
 * Disabled features (tenant_features.enabled=false) always appear as source='override'.
 */
export async function getTenantFeaturesWithSource(
  tenantId: string,
): Promise<FeatureDetailWithSource[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<{ key: string; enabled: boolean; source: string }>(
      `SELECT feature_key AS key, enabled, source
       FROM (
         -- Enabled features with source detection
         SELECT feature_key,
                true AS enabled,
                CASE
                  WHEN plan_count > 0 AND override_count > 0 THEN 'plan+override'
                  WHEN plan_count > 0                        THEN 'plan'
                  ELSE                                            'override'
                END AS source
         FROM (
           SELECT feature_key,
                  COUNT(*) FILTER (WHERE src = 'plan')     AS plan_count,
                  COUNT(*) FILTER (WHERE src = 'override') AS override_count
           FROM (
             -- Plan-granted features (in plan_features, not explicitly disabled)
             SELECT f.key AS feature_key, 'plan' AS src
             FROM tenant_plans tp
             JOIN plan_features pf ON pf.plan_id = tp.plan_id
             JOIN features f ON f.id = pf.feature_id
             WHERE tp.tenant_id = $1
               AND NOT EXISTS (
                 SELECT 1 FROM tenant_features tf_o
                 WHERE tf_o.tenant_id  = $1
                   AND tf_o.feature_id = f.id
                   AND tf_o.enabled    = false
               )

             UNION ALL

             -- Manually enabled features (tenant_features row with enabled=true)
             SELECT f.key AS feature_key, 'override' AS src
             FROM tenant_features tf
             JOIN features f ON f.id = tf.feature_id
             WHERE tf.tenant_id = $1
               AND tf.enabled   = true
           ) _legs
           GROUP BY feature_key
         ) _counts

         UNION ALL

         -- Explicitly disabled features (tenant override = false)
         SELECT f.key AS feature_key, false AS enabled, 'override' AS source
         FROM tenant_features tf
         JOIN features f ON f.id = tf.feature_id
         WHERE tf.tenant_id = $1
           AND tf.enabled   = false
       ) _all
       ORDER BY key`,
      [tenantId],
    );
    return result.rows.map((r) => ({ key: r.key, enabled: r.enabled, source: r.source }));
  });
}

/**
 * Returns all tenant_features rows with enabled state — used by the verbose endpoint.
 * Returns ALL rows regardless of enabled state, so admins see the full picture.
 */
export async function getTenantFeatureDetails(tenantId: string): Promise<FeatureDetail[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<{ key: string; enabled: boolean }>(
      `SELECT f.key, tf.enabled
       FROM tenant_features tf
       JOIN features f ON f.id = tf.feature_id
       WHERE tf.tenant_id = $1
       ORDER BY f.key`,
      [tenantId],
    );
    return result.rows.map((r) => ({ key: r.key, enabled: r.enabled }));
  });
}

/**
 * Returns all tenant_domains rows with enabled state — used by the verbose endpoint.
 */
export async function getTenantDomainDetails(tenantId: string): Promise<DomainDetail[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<{ key: string; name: string; enabled: boolean }>(
      `SELECT d.key, d.name, td.enabled_at IS NOT NULL AS enabled
       FROM tenant_domains td
       JOIN domains d ON d.id = td.domain_id
       WHERE td.tenant_id = $1
       ORDER BY d.key`,
      [tenantId],
    );
    return result.rows.map((r) => ({ key: r.key, name: r.name, enabled: r.enabled }));
  });
}

// ── Domain management ─────────────────────────────────────────────────────────

/**
 * Enables a domain for a tenant.
 *
 * - Upserts tenant_domains with enabled_at = now()
 * - Provisions (or re-enables) all features belonging to the domain
 *
 * Safe to call when the domain is already enabled — idempotent.
 */
export async function enableDomain(tenantId: string, domainKey: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const domainRes = await client.query<{ id: string }>(
      `SELECT id FROM domains WHERE key = $1`,
      [domainKey],
    );
    if (domainRes.rows.length === 0) {
      throw new Error(`Unknown domain '${domainKey}'`);
    }
    const domainId = domainRes.rows[0].id;

    // Upsert tenant_domain — set enabled_at on conflict too (re-enable)
    await client.query(
      `INSERT INTO tenant_domains (tenant_id, domain_id, enabled_at)
       VALUES ($1, $2, now())
       ON CONFLICT (tenant_id, domain_id) DO UPDATE
         SET enabled_at = now()`,
      [tenantId, domainId],
    );

    // Provision / re-enable all features of this domain
    const featuresRes = await client.query<{ feature_id: string }>(
      `SELECT feature_id FROM domain_features WHERE domain_id = $1`,
      [domainId],
    );
    for (const row of featuresRes.rows) {
      await client.query(
        `INSERT INTO tenant_features (tenant_id, feature_id, enabled)
         VALUES ($1, $2, true)
         ON CONFLICT (tenant_id, feature_id) DO UPDATE
           SET enabled = true`,
        [tenantId, row.feature_id],
      );
    }
  });
}

/**
 * Disables a domain for a tenant.
 *
 * - Sets tenant_domains.enabled_at = null
 * - Also sets enabled = false on all tenant_features rows belonging to this domain
 *
 * Does not delete rows (soft-state only).
 * Features shared with another enabled domain are still disabled here —
 * the caller (service layer) is responsible for re-enabling them if needed,
 * or the tenant can re-enable individually via enableFeature().
 */
export async function disableDomain(tenantId: string, domainKey: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const domainRes = await client.query<{ id: string }>(
      `SELECT id FROM domains WHERE key = $1`,
      [domainKey],
    );
    if (domainRes.rows.length === 0) {
      throw new Error(`Unknown domain '${domainKey}'`);
    }
    const domainId = domainRes.rows[0].id;

    // Soft-disable the domain
    await client.query(
      `UPDATE tenant_domains SET enabled_at = null
       WHERE tenant_id = $1 AND domain_id = $2`,
      [tenantId, domainId],
    );

    // Disable all features belonging to this domain
    await client.query(
      `UPDATE tenant_features SET enabled = false
       WHERE tenant_id  = $1
         AND feature_id IN (
           SELECT feature_id FROM domain_features WHERE domain_id = $2
         )`,
      [tenantId, domainId],
    );
  });
}

// ── Feature management ────────────────────────────────────────────────────────

/**
 * Enables a single feature for a tenant.
 * Idempotent — safe to call when already enabled.
 * Creates the row if it does not yet exist (manual override).
 */
export async function enableFeature(tenantId: string, featureKey: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const featureRes = await client.query<{ id: string }>(
      `SELECT id FROM features WHERE key = $1`,
      [featureKey],
    );
    if (featureRes.rows.length === 0) {
      throw new Error(`Unknown feature '${featureKey}'`);
    }
    const featureId = featureRes.rows[0].id;

    await client.query(
      `INSERT INTO tenant_features (tenant_id, feature_id, enabled)
       VALUES ($1, $2, true)
       ON CONFLICT (tenant_id, feature_id) DO UPDATE
         SET enabled = true`,
      [tenantId, featureId],
    );
  });
}

/**
 * Disables a single feature for a tenant.
 * Throws if the feature key does not exist in the global catalogue.
 * No-op if the tenant has no row for this feature yet (soft-state only).
 * Does not delete rows.
 */
export async function disableFeature(tenantId: string, featureKey: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const featureRes = await client.query<{ id: string }>(
      `SELECT id FROM features WHERE key = $1`,
      [featureKey],
    );
    if (featureRes.rows.length === 0) {
      throw new Error(`Unknown feature '${featureKey}'`);
    }
    await client.query(
      `UPDATE tenant_features SET enabled = false
       WHERE tenant_id  = $1
         AND feature_id = $2`,
      [tenantId, featureRes.rows[0].id],
    );
  });
}

// ── Provisioning ──────────────────────────────────────────────────────────────

/**
 * Idempotently provisions a domain for a tenant (additive only).
 *
 * Does not overwrite existing rows — use enableDomain() to re-enable
 * a previously disabled domain.
 *
 * Standard pattern for a new voice tenant:
 *   await provisionTenantDomain(tenantId, 'voice');
 *   await provisionTenantDomain(tenantId, 'salon');
 *
 * JavaScript equivalent (for seed scripts): lib/provision-tenant-domains.js
 */
export async function provisionTenantDomain(
  tenantId: string,
  domainKey: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const domainRes = await client.query<{ id: string }>(
      `SELECT id FROM domains WHERE key = $1`,
      [domainKey],
    );
    if (domainRes.rows.length === 0) {
      throw new Error(`Feature provisioning: unknown domain '${domainKey}'`);
    }
    const domainId = domainRes.rows[0].id;

    await client.query(
      `INSERT INTO tenant_domains (tenant_id, domain_id, enabled_at)
       VALUES ($1, $2, now())
       ON CONFLICT (tenant_id, domain_id) DO NOTHING`,
      [tenantId, domainId],
    );

    const featuresRes = await client.query<{ feature_id: string }>(
      `SELECT feature_id FROM domain_features WHERE domain_id = $1`,
      [domainId],
    );
    for (const row of featuresRes.rows) {
      await client.query(
        `INSERT INTO tenant_features (tenant_id, feature_id, enabled)
         VALUES ($1, $2, true)
         ON CONFLICT (tenant_id, feature_id) DO NOTHING`,
        [tenantId, row.feature_id],
      );
    }
  });
}

// ── Global catalogue (no tenant context needed) ───────────────────────────────

/**
 * Returns all domains from the global catalogue.
 */
export async function listAllDomains(): Promise<Array<{ domain_key: string; name: string }>> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ domain_key: string; name: string }>(
      `SELECT key AS domain_key, name FROM domains ORDER BY key`,
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Returns all features from the global catalogue.
 */
export async function listAllFeatures(): Promise<Array<{ feature_key: string }>> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ feature_key: string }>(
      `SELECT key AS feature_key FROM features ORDER BY key`,
    );
    return result.rows;
  } finally {
    client.release();
  }
}
