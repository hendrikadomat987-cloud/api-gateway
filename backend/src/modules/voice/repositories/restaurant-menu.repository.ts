// src/modules/voice/repositories/restaurant-menu.repository.ts
import { withTenant } from '../../../lib/db.js';

// ── Internal row types from JOIN queries ──────────────────────────────────────

interface MenuRow {
  category_id: string;
  category_name: string;
  item_id: string | null;
  item_name: string | null;
  item_description: string | null;
  item_price_cents: string | null; // pg returns numeric/int as string
}

interface SearchRow {
  id: string;
  name: string;
  description: string | null;
  price_cents: string; // pg returns int as string
  category_name: string;
}

// ── Public result types ───────────────────────────────────────────────────────

export interface MenuCategoryWithItems {
  name: string;
  items: Array<{
    id: string;
    name: string;
    description?: string;
    price: number; // euros (price_cents / 100)
  }>;
}

export interface MenuSearchResult {
  id: string;
  name: string;
  description?: string;
  price: number; // euros (price_cents / 100)
  category: string;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns the full active menu for a tenant, grouped by category.
 * Categories ordered by position; items ordered by name (no sort field on items).
 * Categories have no is_active column — all existing rows are included.
 */
export async function getMenuByTenant(
  tenantId: string,
): Promise<MenuCategoryWithItems[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<MenuRow>(
      `
      SELECT
        rmc.id          AS category_id,
        rmc.name        AS category_name,
        rmi.id          AS item_id,
        rmi.name        AS item_name,
        rmi.description AS item_description,
        rmi.price_cents AS item_price_cents
      FROM restaurant_menu_categories rmc
      LEFT JOIN restaurant_menu_items rmi
        ON  rmi.category_id = rmc.id
        AND rmi.tenant_id   = rmc.tenant_id
        AND rmi.is_active   = true
      WHERE rmc.tenant_id = $1
      ORDER BY rmc.position, rmc.name, rmi.name
      `,
      [tenantId],
    );

    // Group rows by category, preserving ORDER BY order
    const categoryMap = new Map<string, MenuCategoryWithItems>();

    for (const row of result.rows) {
      if (!categoryMap.has(row.category_id)) {
        categoryMap.set(row.category_id, { name: row.category_name, items: [] });
      }

      if (row.item_id !== null && row.item_name !== null && row.item_price_cents !== null) {
        const category = categoryMap.get(row.category_id)!;
        const item: MenuCategoryWithItems['items'][number] = {
          id:    row.item_id,
          name:  row.item_name,
          price: parseInt(row.item_price_cents, 10) / 100,
        };
        if (row.item_description) item.description = row.item_description;
        category.items.push(item);
      }
    }

    return [...categoryMap.values()];
  });
}

/**
 * Case-insensitive search over item name and description.
 * Only returns active items. Returns empty array when nothing matches.
 * Categories have no is_active column — no filter needed there.
 */
export async function searchMenuItems(
  tenantId: string,
  query: string,
): Promise<MenuSearchResult[]> {
  return withTenant(tenantId, async (client) => {
    const pattern = `%${query}%`;

    const result = await client.query<SearchRow>(
      `
      SELECT
        rmi.id          AS id,
        rmi.name        AS name,
        rmi.description AS description,
        rmi.price_cents AS price_cents,
        rmc.name        AS category_name
      FROM restaurant_menu_items rmi
      JOIN restaurant_menu_categories rmc
        ON  rmc.id        = rmi.category_id
        AND rmc.tenant_id = rmi.tenant_id
      WHERE rmi.tenant_id = $1
        AND rmi.is_active = true
        AND (
              rmi.name        ILIKE $2
          OR  rmi.description ILIKE $2
        )
      ORDER BY rmc.position, rmi.name
      `,
      [tenantId, pattern],
    );

    return result.rows.map((row) => {
      const item: MenuSearchResult = {
        id:       row.id,
        name:     row.name,
        price:    parseInt(row.price_cents, 10) / 100,
        category: row.category_name,
      };
      if (row.description) item.description = row.description;
      return item;
    });
  });
}
