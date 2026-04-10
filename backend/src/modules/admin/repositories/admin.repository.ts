// src/modules/admin/repositories/admin.repository.ts
//
// Phase 4B: Admin & Control Layer — DB access.
//
// All queries that cross tenant boundaries use `pool` directly against tables
// that have NO RLS (tenants, plans, plan_limits, domains, features).
// Queries that read tenant-scoped data (tenant_plans, tenant_features,
// usage_counters, etc.) use withTenant(tenantId) so RLS is satisfied.

import { pool, withTenant } from '../../../lib/db.js';
import {
  getEffectiveLimit,
  getCurrentCounter,
  currentPeriodStart,
} from '../../usage/repositories/usage.repository.js';
import {
  getTenantFeatureKeys,
  getTenantDomainKeys,
} from '../../features/repositories/feature.repository.js';
import { getTenantPlan } from '../../features/repositories/plan.repository.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TenantRow {
  id:         string;
  name:       string;
  status:     string;
  created_at: string;
}

export interface PlanCatalogueRow {
  id:         string;
  key:        string;
  name:       string;
  created_at: string;
}

export interface PlanLimitRow {
  feature_key: string;
  limit_type:  string;
  /** null = unlimited */
  limit_value: number | null;
}

export interface PlanDetailRow extends PlanCatalogueRow {
  domains:  string[];
  features: string[];
  limits:   PlanLimitRow[];
}

export interface UsageSummaryItem {
  feature:   string;
  limit_type: string;
  count:     number;
  /** null = unlimited */
  limit:     number | null;
}

export interface TenantAdminDetail {
  id:       string;
  name:     string;
  status:   string;
  plan:     { key: string; name: string; assigned_at: string } | null;
  features: string[];
  domains:  string[];
  usage:    UsageSummaryItem[];
}

// ── Tenant registry ───────────────────────────────────────────────────────────

/**
 * Lists all registered tenants (from the admin-managed `tenants` table).
 * No RLS — this is a global admin catalogue.
 */
export async function listTenants(): Promise<TenantRow[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<TenantRow>(
      `SELECT id::text, name, status, created_at::text
       FROM tenants
       ORDER BY created_at DESC`,
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Returns a single tenant from the registry, or null if not found.
 */
export async function getTenantById(id: string): Promise<TenantRow | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<TenantRow>(
      `SELECT id::text, name, status, created_at::text
       FROM tenants
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/**
 * Upserts a tenant in the registry.
 * Used by POST /internal/admin/tenants to register a new tenant.
 */
export async function upsertTenant(
  id:     string,
  name:   string,
  status: string = 'active',
): Promise<TenantRow> {
  const client = await pool.connect();
  try {
    const result = await client.query<TenantRow>(
      `INSERT INTO tenants (id, name, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET name   = EXCLUDED.name,
             status = EXCLUDED.status
       RETURNING id::text, name, status, created_at::text`,
      [id, name, status],
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

// ── Plan catalogue ────────────────────────────────────────────────────────────

/**
 * Lists all plans from the global catalogue, with their domains, features, and limits.
 */
export async function listPlans(): Promise<PlanDetailRow[]> {
  const client = await pool.connect();
  try {
    // Fetch all plans
    const plansRes = await client.query<PlanCatalogueRow>(
      `SELECT id::text, key, name, created_at::text
       FROM plans
       ORDER BY name`,
    );

    const rows: PlanDetailRow[] = [];
    for (const plan of plansRes.rows) {
      const [domains, features, limits] = await Promise.all([
        _getPlanDomains(client, plan.id),
        _getPlanFeatures(client, plan.id),
        _getPlanLimits(client, plan.id),
      ]);
      rows.push({ ...plan, domains, features, limits });
    }
    return rows;
  } finally {
    client.release();
  }
}

/**
 * Returns a single plan by key, with domains, features, and limits.
 * Returns null if not found.
 */
export async function getPlanDetail(planKey: string): Promise<PlanDetailRow | null> {
  const client = await pool.connect();
  try {
    const planRes = await client.query<PlanCatalogueRow>(
      `SELECT id::text, key, name, created_at::text
       FROM plans
       WHERE key = $1`,
      [planKey],
    );
    if (planRes.rows.length === 0) return null;

    const plan = planRes.rows[0];
    const [domains, features, limits] = await Promise.all([
      _getPlanDomains(client, plan.id),
      _getPlanFeatures(client, plan.id),
      _getPlanLimits(client, plan.id),
    ]);
    return { ...plan, domains, features, limits };
  } finally {
    client.release();
  }
}

async function _getPlanDomains(client: import('pg').PoolClient, planId: string): Promise<string[]> {
  const r = await client.query<{ key: string }>(
    `SELECT d.key
     FROM plan_domains pd
     JOIN domains d ON d.id = pd.domain_id
     WHERE pd.plan_id = $1
     ORDER BY d.key`,
    [planId],
  );
  return r.rows.map(row => row.key);
}

async function _getPlanFeatures(client: import('pg').PoolClient, planId: string): Promise<string[]> {
  const r = await client.query<{ key: string }>(
    `SELECT f.key
     FROM plan_features pf
     JOIN features f ON f.id = pf.feature_id
     WHERE pf.plan_id = $1
     ORDER BY f.key`,
    [planId],
  );
  return r.rows.map(row => row.key);
}

async function _getPlanLimits(client: import('pg').PoolClient, planId: string): Promise<PlanLimitRow[]> {
  const r = await client.query<PlanLimitRow>(
    `SELECT feature_key, limit_type, limit_value
     FROM plan_limits
     WHERE plan_id = $1
     ORDER BY feature_key, limit_type`,
    [planId],
  );
  return r.rows;
}

// ── Tenant detail ─────────────────────────────────────────────────────────────

/**
 * Returns the full admin profile for a tenant:
 *   plan, enabled features, enabled domains, current-period usage with limits.
 *
 * Uses withTenant() for every tenant-scoped table.
 */
export async function getTenantAdminDetail(tenantId: string): Promise<TenantAdminDetail> {
  const [tenant, planRow, features, domains, usageItems] = await Promise.all([
    getTenantById(tenantId),
    getTenantPlan(tenantId),
    getTenantFeatureKeys(tenantId),
    getTenantDomainKeys(tenantId),
    _buildUsageSummary(tenantId),
  ]);

  return {
    id:       tenant?.id ?? tenantId,
    name:     tenant?.name ?? '',
    status:   tenant?.status ?? 'active',
    plan:     planRow
      ? { key: planRow.plan_key, name: planRow.plan_name, assigned_at: planRow.assigned_at }
      : null,
    features,
    domains,
    usage:    usageItems,
  };
}

/**
 * Builds the current-period usage summary for a tenant.
 * Returns one item per (feature_key, limit_type) counter row.
 */
async function _buildUsageSummary(tenantId: string): Promise<UsageSummaryItem[]> {
  const period = currentPeriodStart();

  // Read all counter rows for this period using withTenant (RLS)
  const counters = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ feature_key: string; limit_type: string; current_value: number }>(
      `SELECT feature_key, limit_type, current_value
       FROM usage_counters
       WHERE tenant_id    = $1
         AND period_start = $2
       ORDER BY feature_key, limit_type`,
      [tenantId, period],
    );
    return r.rows;
  });

  // For each counter row, resolve the effective limit in parallel
  const items = await Promise.all(
    counters.map(async (row): Promise<UsageSummaryItem> => {
      const { limit_value } = await getEffectiveLimit(tenantId, row.feature_key, row.limit_type);
      return {
        feature:    row.feature_key,
        limit_type: row.limit_type,
        count:      row.current_value,
        limit:      limit_value,
      };
    }),
  );

  return items;
}

// ── Tenant limits ─────────────────────────────────────────────────────────────

export interface TenantLimitRow {
  feature_key: string;
  limit_type:  string;
  /** null = explicitly unlimited */
  limit_value: number | null;
  source:      'override' | 'plan' | 'none';
}

/**
 * Returns the effective limit for every (feature_key, limit_type) pair
 * for which a counter or an override or a plan limit exists for this tenant.
 *
 * This gives the admin a complete view of what limits are in play.
 */
export async function getTenantLimits(tenantId: string): Promise<TenantLimitRow[]> {
  // Collect all (feature_key, limit_type) tuples from:
  //   1. tenant_override_limits (explicit overrides)
  //   2. plan_limits for the tenant's plan (baseline)
  const tuples = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ feature_key: string; limit_type: string }>(
      `-- Override rows
       SELECT feature_key, limit_type
       FROM tenant_override_limits
       WHERE tenant_id = $1

       UNION

       -- Plan limit rows for this tenant's plan
       SELECT pl.feature_key, pl.limit_type
       FROM tenant_plans tp
       JOIN plan_limits pl ON pl.plan_id = tp.plan_id
       WHERE tp.tenant_id = $1

       ORDER BY feature_key, limit_type`,
      [tenantId],
    );
    return r.rows;
  });

  // Resolve effective limit for each tuple
  const results = await Promise.all(
    tuples.map(async ({ feature_key, limit_type }): Promise<TenantLimitRow> => {
      const eff = await getEffectiveLimit(tenantId, feature_key, limit_type);
      return {
        feature_key,
        limit_type,
        limit_value: eff.limit_value,
        source:      eff.source as 'override' | 'plan' | 'none',
      };
    }),
  );

  return results;
}
