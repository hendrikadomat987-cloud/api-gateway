// src/modules/voice/repositories/salon-settings.repository.ts
//
// Tenant-level configuration for the Salon domain.
// Analogous to restaurant-settings.repository.ts.

import { withTenant } from '../../../lib/db.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OpeningHoursEntry {
  open:  string; // "09:00"
  close: string; // "18:00"
}

export interface SalonSettings {
  opening_hours?:      Record<string, OpeningHoursEntry>; // key = lowercase weekday
  slot_duration_min?:  number; // default appointment slot in minutes
  advance_book_days?:  number; // how many days ahead bookings can be made
  faq?:                Record<string, string>; // intent key → answer
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: SalonSettings = {
  opening_hours: {
    monday:    { open: '09:00', close: '18:00' },
    tuesday:   { open: '09:00', close: '18:00' },
    wednesday: { open: '09:00', close: '18:00' },
    thursday:  { open: '09:00', close: '20:00' },
    friday:    { open: '09:00', close: '18:00' },
    saturday:  { open: '09:00', close: '15:00' },
  },
  slot_duration_min: 30,
  advance_book_days: 30,
};

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Returns the salon settings for a tenant.
 * Falls back to DEFAULT_SETTINGS when no row exists.
 */
export async function getSalonSettings(
  tenantId: string,
): Promise<SalonSettings> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<{ settings: SalonSettings }>(
      `SELECT settings FROM salon_settings WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    if (result.rows.length === 0) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...result.rows[0].settings };
  });
}
