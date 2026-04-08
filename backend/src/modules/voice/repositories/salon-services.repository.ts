// src/modules/voice/repositories/salon-services.repository.ts
//
// Service catalogue queries for the Salon domain.
// Analogous to restaurant-menu.repository.ts.

import { withTenant } from '../../../lib/db.js';

// ── Row types ─────────────────────────────────────────────────────────────────

interface ServiceRow {
  id:               string;
  category:         string;
  name:             string;
  description:      string | null;
  duration_minutes: string; // pg returns int as string
  price_cents:      string;
}

// ── Public result types ───────────────────────────────────────────────────────

export interface SalonServiceResult {
  id:               string;
  category:         string;
  name:             string;
  description?:     string;
  duration_minutes: number;
  price_cents:      number;
  price:            number; // euros (price_cents / 100)
}

export interface SalonServiceCategoryGroup {
  category: string;
  services: SalonServiceResult[];
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns all active services for a tenant, grouped by category.
 * Categories ordered alphabetically; services ordered by name within category.
 */
export async function getServicesByTenant(
  tenantId: string,
): Promise<SalonServiceCategoryGroup[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<ServiceRow>(
      `SELECT id, category, name, description, duration_minutes, price_cents
       FROM salon_services
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY category, name`,
      [tenantId],
    );

    const map = new Map<string, SalonServiceResult[]>();
    for (const row of result.rows) {
      if (!map.has(row.category)) map.set(row.category, []);
      const item: SalonServiceResult = {
        id:               row.id,
        category:         row.category,
        name:             row.name,
        duration_minutes: parseInt(row.duration_minutes, 10),
        price_cents:      parseInt(row.price_cents, 10),
        price:            parseInt(row.price_cents, 10) / 100,
      };
      if (row.description) item.description = row.description;
      map.get(row.category)!.push(item);
    }

    return [...map.entries()].map(([category, services]) => ({ category, services }));
  });
}

/**
 * Fetches a single active service by UUID.
 * Returns null when the service does not exist or is inactive.
 */
export async function findServiceById(
  tenantId: string,
  id: string,
): Promise<SalonServiceResult | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<ServiceRow>(
      `SELECT id, category, name, description, duration_minutes, price_cents
       FROM salon_services
       WHERE tenant_id = $1 AND id = $2 AND is_active = true
       LIMIT 1`,
      [tenantId, id],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    const item: SalonServiceResult = {
      id:               row.id,
      category:         row.category,
      name:             row.name,
      duration_minutes: parseInt(row.duration_minutes, 10),
      price_cents:      parseInt(row.price_cents, 10),
      price:            parseInt(row.price_cents, 10) / 100,
    };
    if (row.description) item.description = row.description;
    return item;
  });
}

/**
 * Case-insensitive search over service name and description.
 * Only returns active services.
 */
export async function searchServices(
  tenantId: string,
  query: string,
): Promise<SalonServiceResult[]> {
  return withTenant(tenantId, async (client) => {
    const pattern = `%${query}%`;
    const result = await client.query<ServiceRow>(
      `SELECT id, category, name, description, duration_minutes, price_cents
       FROM salon_services
       WHERE tenant_id = $1
         AND is_active = true
         AND (name ILIKE $2 OR description ILIKE $2)
       ORDER BY category, name`,
      [tenantId, pattern],
    );
    return result.rows.map((row) => {
      const item: SalonServiceResult = {
        id:               row.id,
        category:         row.category,
        name:             row.name,
        duration_minutes: parseInt(row.duration_minutes, 10),
        price_cents:      parseInt(row.price_cents, 10),
        price:            parseInt(row.price_cents, 10) / 100,
      };
      if (row.description) item.description = row.description;
      return item;
    });
  });
}
