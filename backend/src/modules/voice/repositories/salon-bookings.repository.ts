// src/modules/voice/repositories/salon-bookings.repository.ts
//
// Persistence layer for salon bookings and booking-service line items.
// Analogous to restaurant-order.repository.ts.
// Uses withTenant for all writes since salon_bookings has RLS enabled.

import { withTenant } from '../../../lib/db.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SalonBookingServiceRow {
  id:               string;
  booking_id:       string;
  service_id:       string;
  name_snapshot:    string;
  duration_minutes: number;
  price_cents:      number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Creates a new salon_bookings row. Returns the generated UUID.
 */
export async function createSalonBooking(
  tenantId: string,
  data: {
    source?:        'voice' | 'web' | 'app';
    customerName?:  string | null;
    customerPhone?: string | null;
  },
): Promise<string> {
  return withTenant(tenantId, async (client) => {
    const source = data.source ?? 'voice';
    const result = await client.query<{ id: string }>(
      `INSERT INTO salon_bookings
         (tenant_id, status, source, customer_name, customer_phone)
       VALUES ($1, 'draft', $2, $3, $4)
       RETURNING id`,
      [tenantId, source, data.customerName ?? null, data.customerPhone ?? null],
    );
    return result.rows[0].id;
  });
}

/**
 * Inserts a booking-service line item. Returns the generated UUID.
 */
export async function addSalonBookingService(
  tenantId: string,
  bookingId: string,
  data: {
    serviceId:       string;
    nameSnapshot:    string;
    durationMinutes: number;
    priceCents:      number;
  },
): Promise<string> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO salon_booking_services
         (tenant_id, booking_id, service_id, name_snapshot, duration_minutes, price_cents)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        tenantId,
        bookingId,
        data.serviceId,
        data.nameSnapshot,
        data.durationMinutes,
        data.priceCents,
      ],
    );
    return result.rows[0].id;
  });
}

/**
 * Deletes a salon_booking_services row by its UUID.
 */
export async function deleteSalonBookingService(
  tenantId: string,
  bookingServiceId: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `DELETE FROM salon_booking_services WHERE tenant_id = $1 AND id = $2`,
      [tenantId, bookingServiceId],
    );
  });
}

/**
 * Updates a salon_bookings row with final totals and appointment times.
 */
export async function finalizeSalonBooking(
  tenantId: string,
  bookingId: string,
  data: {
    totalPriceCents:   number;
    totalDurationMin:  number;
    appointmentStart?: string | null;
    appointmentEnd?:   string | null;
    stylistId?:        string | null;
    customerName?:     string | null;
    customerPhone?:    string | null;
  },
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE salon_bookings
       SET status             = 'confirmed',
           total_price_cents  = $3,
           total_duration_min = $4,
           appointment_start  = $5,
           appointment_end    = $6,
           stylist_id         = $7,
           customer_name      = COALESCE($8, customer_name),
           customer_phone     = COALESCE($9, customer_phone),
           confirmed_at       = now(),
           updated_at         = now()
       WHERE tenant_id = $1 AND id = $2`,
      [
        tenantId,
        bookingId,
        data.totalPriceCents,
        data.totalDurationMin,
        data.appointmentStart ?? null,
        data.appointmentEnd   ?? null,
        data.stylistId        ?? null,
        data.customerName     ?? null,
        data.customerPhone    ?? null,
      ],
    );
  });
}

/**
 * Returns all booking-service rows for a booking, ordered by insertion time.
 */
export async function getSalonBookingServices(
  tenantId: string,
  bookingId: string,
): Promise<SalonBookingServiceRow[]> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query<SalonBookingServiceRow>(
      `SELECT id, booking_id, service_id, name_snapshot, duration_minutes, price_cents
       FROM salon_booking_services
       WHERE tenant_id = $1 AND booking_id = $2
       ORDER BY ctid`,
      [tenantId, bookingId],
    );
    return result.rows;
  });
}
