// src/modules/features/repositories/plan.repository.ts
//
// DB access for the Pricing & Plan System V1.
// plans / plan_domains / plan_features are global catalogues (no RLS).
// tenant_plans is RLS-protected — all writes use withTenant().
//
// Actual DB schema (plans tables, as created by 20260410000002):
//   plans        — id, key, name, created_at
//   plan_domains — plan_id, domain_id
//   plan_features— plan_id, feature_id
//   tenant_plans — tenant_id (PK), plan_id, assigned_at  (RLS)

import { withTenant, pool } from '../../../lib/db.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanRow {
  id:   string;
  key:  string;
  name: string;
}

export interface TenantPlanRow {
  plan_key:    string;
  plan_name:   string;
  assigned_at: string;
}

// ── Global catalogue (no tenant context) ──────────────────────────────────────

/**
 * Returns a plan by key, or null if not found.
 */
export async function getPlanByKey(planKey: string): Promise<PlanRow | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<PlanRow>(
      `SELECT id, key, name FROM plans WHERE key = $1`,
      [planKey],
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/**
 * Returns all domain keys included in a plan.
 */
export async function getPlanDomains(planId: string): Promise<string[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ domain_key: string }>(
      `SELECT d.key AS domain_key
       FROM plan_domains pd
       JOIN domains d ON d.id = pd.domain_id
       WHERE pd.plan_id = $1
       ORDER BY d.key`,
      [planId],
    );
    return result.rows.map((r) => r.domain_key);
  } finally {
    client.release();
  }
}

/**
 * Returns all feature keys included in a plan.
 */
export async function getPlanFeatures(planId: string): Promise<string[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ feature_key: string }>(
      `SELECT f.key AS feature_key
       FROM plan_features pf
       JOIN features f ON f.id = pf.feature_id
       WHERE pf.plan_id = $1
       ORDER BY f.key`,
      [planId],
    );
    return result.rows.map((r) => r.feature_key);
  } finally {
    client.release();
  }
}

// ── Tenant-scoped ──────────────────────────────────────────────────────────────

/**
 * Assigns a plan to a tenant.
 * Replaces any existing plan assignment (upsert on tenant_id PK).
 * Throws if the plan key does not exist.
 */
export async function assignPlanToTenant(
  tenantId: string,
  planKey:  string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const planRes = await client.query<{ id: string }>(
      `SELECT id FROM plans WHERE key = $1`,
      [planKey],
    );
    if (planRes.rows.length === 0) {
      throw new Error(`Unknown plan '${planKey}'`);
    }
    const planId = planRes.rows[0].id;

    await client.query(
      `INSERT INTO tenant_plans (tenant_id, plan_id, assigned_at)
       VALUES ($1, $2, now())
       ON CONFLICT (tenant_id) DO UPDATE
         SET plan_id     = EXCLUDED.plan_id,
             assigned_at = EXCLUDED.assigned_at`,
      [tenantId, planId],
    );
  });
}

/**
 * Returns the current plan assignment for a tenant, or null if none.
 */
export async function getTenantPlan(tenantId: string): Promise<TenantPlanRow | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<TenantPlanRow>(
      `SELECT p.key AS plan_key, p.name AS plan_name, tp.assigned_at
       FROM tenant_plans tp
       JOIN plans p ON p.id = tp.plan_id
       WHERE tp.tenant_id = $1`,
      [tenantId],
    );
    return result.rows[0] ?? null;
  });
}
