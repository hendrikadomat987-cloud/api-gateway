// src/modules/voice/repositories/restaurant-settings.repository.ts
import { pool } from '../../../lib/db.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OpeningHoursEntry {
  open:  string; // "11:00"
  close: string; // "22:00"
}

export interface RestaurantSettings {
  opening_hours?:    Record<string, OpeningHoursEntry>; // key = lowercase weekday
  eta_pickup_min?:   number; // minutes
  eta_pickup_max?:   number;
  eta_delivery_min?: number;
  eta_delivery_max?: number;
}

// ── Defaults (used when no row exists for tenant) ─────────────────────────────

const DEFAULT_SETTINGS: RestaurantSettings = {
  opening_hours: {
    monday:    { open: '11:00', close: '22:00' },
    tuesday:   { open: '11:00', close: '22:00' },
    wednesday: { open: '11:00', close: '22:00' },
    thursday:  { open: '11:00', close: '22:00' },
    friday:    { open: '11:00', close: '23:00' },
    saturday:  { open: '11:00', close: '23:00' },
    sunday:    { open: '12:00', close: '21:00' },
  },
  eta_pickup_min:   15,
  eta_pickup_max:   20,
  eta_delivery_min: 30,
  eta_delivery_max: 45,
};

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Returns the settings for a tenant.
 * Falls back to DEFAULT_SETTINGS when no row exists (graceful degradation).
 */
export async function getRestaurantSettings(
  tenantId: string,
): Promise<RestaurantSettings> {
  const result = await pool.query<{ settings: RestaurantSettings }>(
    `SELECT settings FROM restaurant_settings WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );

  if (result.rows.length === 0) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...result.rows[0].settings };
}

/**
 * Returns all active delivery zones as a summary:
 *   { min_order_cents, fees: number[] }
 */
export interface DeliveryZoneSummary {
  min_order_cents: number; // lowest minimum across all zones
  fee_cents_min:   number;
  fee_cents_max:   number;
  postal_codes:    string[];
}

export async function getDeliveryZoneSummary(
  tenantId: string,
): Promise<DeliveryZoneSummary | null> {
  const result = await pool.query<{
    min_order_cents: string;
    fee_cents_min: string;
    fee_cents_max: string;
    postal_codes: string;
  }>(
    `SELECT
       MIN(min_order_cents)::text  AS min_order_cents,
       MIN(delivery_fee_cents)::text AS fee_cents_min,
       MAX(delivery_fee_cents)::text AS fee_cents_max,
       STRING_AGG(postal_code, ', ' ORDER BY postal_code) AS postal_codes
     FROM restaurant_delivery_zones
     WHERE tenant_id = $1 AND is_active = true`,
    [tenantId],
  );

  const row = result.rows[0];
  if (!row || row.min_order_cents === null) return null;

  return {
    min_order_cents: parseInt(row.min_order_cents, 10),
    fee_cents_min:   parseInt(row.fee_cents_min, 10),
    fee_cents_max:   parseInt(row.fee_cents_max, 10),
    postal_codes:    row.postal_codes ? row.postal_codes.split(', ') : [],
  };
}
