// src/modules/voice/repositories/restaurant-delivery.repository.ts
import { pool } from '../../../lib/db.js';

// ── Public result type ────────────────────────────────────────────────────────

export interface DeliveryZone {
  id: string;
  postal_code: string;
  zone_name: string;
  delivery_fee_cents: number;
  min_order_cents: number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Looks up an active delivery zone by postal code for a tenant.
 * Returns null when the postal code is unknown or outside the delivery area.
 */
export async function findDeliveryZone(
  tenantId: string,
  postalCode: string,
): Promise<DeliveryZone | null> {
  const result = await pool.query<{
    id: string;
    postal_code: string;
    zone_name: string;
    delivery_fee_cents: string;
    min_order_cents: string;
  }>(
    `SELECT id, postal_code, zone_name, delivery_fee_cents, min_order_cents
     FROM restaurant_delivery_zones
     WHERE tenant_id = $1 AND postal_code = $2 AND is_active = true
     LIMIT 1`,
    [tenantId, postalCode],
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id:                 row.id,
    postal_code:        row.postal_code,
    zone_name:          row.zone_name,
    delivery_fee_cents: parseInt(row.delivery_fee_cents, 10),
    min_order_cents:    parseInt(row.min_order_cents, 10),
  };
}
