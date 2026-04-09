'use strict';

/**
 * lib/provision-tenant-domains.js
 *
 * Single source of truth for "domain activation → tenant features" logic
 * in Node.js seed scripts.
 *
 * Design:
 *   Accepts an already-open pg client (or pool connection) and a list of
 *   domain keys to activate for a tenant. For each domain it:
 *     1. Resolves the domain UUID from the global catalogue.
 *     2. Inserts a tenant_domains row (idempotent: ON CONFLICT DO NOTHING).
 *     3. For every feature in domain_features, inserts a tenant_features row
 *        (idempotent: ON CONFLICT DO NOTHING, source='domain_provisioned').
 *
 * Voice rule:
 *   Always include 'voice' in the domainKeys array. Every voice-capable tenant
 *   requires voice.core and voice.callback, which are seeded under the 'voice'
 *   domain. The function does NOT inject 'voice' automatically — callers are
 *   responsible for including it. This keeps provisioning explicit and auditable.
 *
 *   Standard invocation for a salon tenant:
 *     await provisionTenantDomains(client, tenantId, ['voice', 'salon']);
 *
 * Note: This function runs outside any transaction because provisioning is
 * designed to be safe to retry. If the caller wraps it in a transaction, the
 * ON CONFLICT DO NOTHING clauses still ensure idempotency.
 *
 * TypeScript equivalent: feature.repository.ts → provisionTenantDomain()
 * (The TS version is used at runtime; this JS version is used by seed scripts
 * which run as standalone Node processes, not through the compiled backend.)
 */

/**
 * @param {import('pg').PoolClient} client  - open pg client (NOT released by this fn)
 * @param {string}                  tenantId - UUID of the tenant to provision
 * @param {string[]}                domainKeys - ordered list of domain keys to activate
 * @returns {Promise<void>}
 */
async function provisionTenantDomains(client, tenantId, domainKeys) {
  for (const domainKey of domainKeys) {
    // 1. Resolve domain from catalogue
    const domRes = await client.query(
      `SELECT id FROM domains WHERE domain_key = $1 AND is_active = true`,
      [domainKey],
    );
    if (domRes.rows.length === 0) {
      console.log(
        `  ⚠ Domain '${domainKey}' not found — run feature-system migration first ` +
        `(20260409000000_feature_system_v1.sql)`,
      );
      continue;
    }
    const domainId = domRes.rows[0].id;

    // 2. Activate domain for tenant
    await client.query(
      `INSERT INTO tenant_domains (tenant_id, domain_id, is_enabled)
       VALUES ($1, $2, true)
       ON CONFLICT (tenant_id, domain_id) DO NOTHING`,
      [tenantId, domainId],
    );

    // 3. Provision every feature belonging to this domain
    const featRows = await client.query(
      `SELECT feature_id FROM domain_features WHERE domain_id = $1`,
      [domainId],
    );
    for (const row of featRows.rows) {
      await client.query(
        `INSERT INTO tenant_features (tenant_id, feature_id, is_enabled, source)
         VALUES ($1, $2, true, 'domain_provisioned')
         ON CONFLICT (tenant_id, feature_id) DO NOTHING`,
        [tenantId, row.feature_id],
      );
    }

    console.log(`  ✓ Domain '${domainKey}' provisioned`);
  }
}

module.exports = { provisionTenantDomains };
