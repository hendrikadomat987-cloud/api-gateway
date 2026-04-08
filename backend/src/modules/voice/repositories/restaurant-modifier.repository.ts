// src/modules/voice/repositories/restaurant-modifier.repository.ts
import { withTenant } from '../../../lib/db.js';

// ── Internal row type ─────────────────────────────────────────────────────────

interface ModifierRow {
  id: string;
  name: string;
  type: 'add' | 'remove' | 'free_text';
  price_cents: string; // pg returns integer as string
}

// ── Public result type ────────────────────────────────────────────────────────

export interface ModifierCatalogEntry {
  id: string;
  name: string;
  type: 'add' | 'remove' | 'free_text';
  price_cents: number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Looks up a single active modifier by name (case-insensitive) and type.
 * Returns null when not found or inactive.
 */
export async function findModifierByNameAndType(
  tenantId: string,
  name: string,
  type: 'add' | 'remove' | 'free_text',
): Promise<ModifierCatalogEntry | null> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<ModifierRow>(
      `
      SELECT id, name, type, price_cents
      FROM restaurant_menu_modifiers
      WHERE tenant_id = $1
        AND LOWER(name) = LOWER($2)
        AND type = $3
        AND is_active = true
      LIMIT 1
      `,
      [tenantId, name, type],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id:          row.id,
      name:        row.name,
      type:        row.type,
      price_cents: parseInt(row.price_cents, 10),
    };
  });
}

/**
 * Returns all active modifiers for a tenant.
 * Ordered by type then name for stable output.
 */
export async function getModifiersByTenant(
  tenantId: string,
): Promise<ModifierCatalogEntry[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<ModifierRow>(
      `
      SELECT id, name, type, price_cents
      FROM restaurant_menu_modifiers
      WHERE tenant_id = $1
        AND is_active = true
      ORDER BY type, name
      `,
      [tenantId],
    );

    return result.rows.map((row) => ({
      id:          row.id,
      name:        row.name,
      type:        row.type,
      price_cents: parseInt(row.price_cents, 10),
    }));
  });
}
