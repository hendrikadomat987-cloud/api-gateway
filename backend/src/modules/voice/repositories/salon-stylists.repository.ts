// src/modules/voice/repositories/salon-stylists.repository.ts

import { withTenant } from '../../../lib/db.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SalonStylist {
  id:        string;
  tenant_id: string;
  name:      string;
  specialty: string | null;
  is_active: boolean;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns all active stylists for a tenant, ordered by name.
 */
export async function getStylistsByTenant(
  tenantId: string,
): Promise<SalonStylist[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<SalonStylist>(
      `SELECT id, tenant_id, name, specialty, is_active
       FROM salon_stylists
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY name`,
      [tenantId],
    );
    return result.rows;
  });
}

/**
 * Finds a stylist by UUID. Returns null when not found or inactive.
 */
export async function findStylistById(
  tenantId: string,
  id: string,
): Promise<SalonStylist | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<SalonStylist>(
      `SELECT id, tenant_id, name, specialty, is_active
       FROM salon_stylists
       WHERE tenant_id = $1 AND id = $2 AND is_active = true
       LIMIT 1`,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  });
}

/**
 * Case-insensitive name search for stylist resolution.
 * Returns all active stylists whose name contains the query.
 */
export async function searchStylistsByName(
  tenantId: string,
  name: string,
): Promise<SalonStylist[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<SalonStylist>(
      `SELECT id, tenant_id, name, specialty, is_active
       FROM salon_stylists
       WHERE tenant_id = $1 AND is_active = true AND name ILIKE $2
       ORDER BY name`,
      [tenantId, `%${name}%`],
    );
    return result.rows;
  });
}
