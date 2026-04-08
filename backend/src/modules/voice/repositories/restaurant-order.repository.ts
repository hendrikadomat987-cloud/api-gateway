// src/modules/voice/repositories/restaurant-order.repository.ts
import { pool } from '../../../lib/db.js';
import type { OrderItemModifier } from '../../../types/voice.js';

// ── Row types ─────────────────────────────────────────────────────────────────

interface OrderItemRow {
  id: string;
  order_id: string;
  menu_item_id: string;
  name_snapshot: string | null;
  quantity: number;
  price_cents: number;
  modifiers_json: OrderItemModifier[];
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Creates a new restaurant_orders row.
 * Returns the generated UUID.
 */
export async function createRestaurantOrder(
  tenantId: string,
  data: {
    source?:              'voice' | 'web' | 'app';
    status?:              string;
    totalCents?:          number;
    deliveryType?:        'pickup' | 'delivery';
    customerPostalCode?:  string | null;
    customerName?:        string | null;
  },
): Promise<string> {
  const source      = data.source      ?? 'voice';
  const status      = data.status      ?? 'draft';
  const totalCents  = data.totalCents  ?? 0;
  const deliveryType = data.deliveryType ?? 'pickup';

  const result = await pool.query<{ id: string }>(
    `INSERT INTO restaurant_orders
       (tenant_id, status, total_cents, source,
        delivery_type, customer_postal_code, customer_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      tenantId, status, totalCents, source,
      deliveryType, data.customerPostalCode ?? null, data.customerName ?? null,
    ],
  );

  return result.rows[0].id;
}

/**
 * Updates the running totals (subtotal, delivery fee, grand total) on an order.
 */
export async function updateOrderTotals(
  tenantId: string,
  orderId: string,
  data: {
    subtotalCents:    number;
    deliveryFeeCents: number;
    totalCents:       number;
  },
): Promise<void> {
  await pool.query(
    `UPDATE restaurant_orders
     SET subtotal_cents = $3, delivery_fee_cents = $4, total_cents = $5
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId, data.subtotalCents, data.deliveryFeeCents, data.totalCents],
  );
}

/**
 * Inserts a single order item with modifiers.
 * Returns the generated UUID for the order item row.
 */
export async function addRestaurantOrderItem(
  tenantId: string,
  orderId: string,
  data: {
    menuItemId: string;
    nameSnapshot: string;
    quantity: number;
    priceCents: number;
    prepTimeSecondsSnapshot: number;
    modifiersJson: OrderItemModifier[];
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO restaurant_order_items
       (tenant_id, order_id, menu_item_id, name_snapshot,
        quantity, price_cents, prep_time_seconds_snapshot, modifiers_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      tenantId,
      orderId,
      data.menuItemId,
      data.nameSnapshot,
      data.quantity,
      data.priceCents,
      data.prepTimeSecondsSnapshot,
      JSON.stringify(data.modifiersJson),
    ],
  );

  return result.rows[0].id;
}

/**
 * Updates quantity, price, and/or modifiers on an existing order item.
 * Only the fields provided in `data` are updated.
 */
export async function updateRestaurantOrderItem(
  tenantId: string,
  orderItemId: string,
  data: { quantity?: number; priceCents?: number; modifiersJson?: OrderItemModifier[] },
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [tenantId, orderItemId];

  if (data.quantity !== undefined) {
    sets.push(`quantity = $${vals.length + 1}`);
    vals.push(data.quantity);
  }
  if (data.priceCents !== undefined) {
    sets.push(`price_cents = $${vals.length + 1}`);
    vals.push(data.priceCents);
  }
  if (data.modifiersJson !== undefined) {
    sets.push(`modifiers_json = $${vals.length + 1}`);
    vals.push(JSON.stringify(data.modifiersJson));
  }

  if (sets.length === 0) return;

  await pool.query(
    `UPDATE restaurant_order_items SET ${sets.join(', ')}
     WHERE tenant_id = $1 AND id = $2`,
    vals,
  );
}

/**
 * Sets a restaurant_orders row to 'confirmed' and stamps accepted_at.
 */
export async function finalizeRestaurantOrder(
  tenantId: string,
  orderId: string,
): Promise<void> {
  await pool.query(
    `UPDATE restaurant_orders
     SET status = 'confirmed', accepted_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId],
  );
}

/**
 * Deletes a single restaurant_order_items row by its UUID.
 * No-op when the row does not exist.
 */
export async function deleteRestaurantOrderItem(
  tenantId: string,
  orderItemId: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM restaurant_order_items WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderItemId],
  );
}

/**
 * Returns all order items for a given order, ordered by insertion time.
 */
export async function getRestaurantOrderItems(
  tenantId: string,
  orderId: string,
): Promise<OrderItemRow[]> {
  const result = await pool.query<OrderItemRow>(
    `SELECT id, order_id, menu_item_id, name_snapshot, quantity, price_cents, modifiers_json
     FROM restaurant_order_items
     WHERE tenant_id = $1 AND order_id = $2
     ORDER BY ctid`,
    [tenantId, orderId],
  );
  return result.rows;
}
