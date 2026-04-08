// src/modules/voice/tools/salon/confirm-booking.tool.ts
//
// confirm_booking — finalises the active salon booking for this voice session.
// Analogous to restaurant/confirm-order.tool.ts.

import type { VoiceContext } from '../../../../types/voice.js';
import {
  findSalonContextBySessionId,
  confirmSalonContext,
  upsertSalonContext,
} from '../../repositories/voice-salon-contexts.repository.js';
import { finalizeSalonBooking } from '../../repositories/salon-bookings.repository.js';
import { validateBookingReadyToConfirm } from './booking-guards.js';
import type { ContextService } from './booking-reference-resolver.js';

export async function runConfirmBooking(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const ctx = await findSalonContextBySessionId(context.tenantId, context.session.id);

  if (!ctx) {
    return { success: false, error: 'no_active_booking', message: 'No active booking found for this session.' };
  }

  // Idempotent: already confirmed
  if (ctx.status === 'confirmed') {
    const json      = ctx.booking_context_json as Record<string, unknown>;
    const bookingId = json.salon_booking_id as string | undefined;
    return {
      success:    false,
      error:      'already_confirmed',
      booking_id: bookingId ?? 'unknown',
      message:    'This booking has already been confirmed.',
    };
  }

  const json = ctx.booking_context_json as Record<string, unknown>;

  // Allow caller to supply / update context fields at confirm time
  if (args.customer_name  && typeof args.customer_name  === 'string') json.customer_name  = args.customer_name;
  if (args.customer_phone && typeof args.customer_phone === 'string') json.customer_phone = args.customer_phone;
  if (args.selected_date  && typeof args.selected_date  === 'string') json.selected_date  = args.selected_date;
  if (args.selected_time_slot && typeof args.selected_time_slot === 'string') json.selected_time_slot = args.selected_time_slot;
  if (args.stylist_id && typeof args.stylist_id === 'string') json.selected_stylist_id = args.stylist_id;

  // Guard: readiness validation
  const readyErr = validateBookingReadyToConfirm(json);
  if (readyErr) return readyErr;

  const bookingId     = json.salon_booking_id as string;
  const services      = (json.selected_services as ContextService[] | undefined) ?? [];
  const totalPriceCents  = services.reduce((s, x) => s + x.price_cents, 0);
  const totalDurationMin = services.reduce((s, x) => s + x.duration_minutes, 0);

  // Build appointment timestamps from date + time slot
  const appointmentStart = buildTimestamp(
    json.selected_date as string,
    json.selected_time_slot as string,
  );
  const appointmentEnd = appointmentStart
    ? addMinutes(appointmentStart, totalDurationMin)
    : null;

  // Finalize DB row
  await finalizeSalonBooking(context.tenantId, bookingId, {
    totalPriceCents,
    totalDurationMin,
    appointmentStart,
    appointmentEnd,
    stylistId:     (json.selected_stylist_id as string | null) ?? null,
    customerName:  (json.customer_name  as string | null) ?? null,
    customerPhone: (json.customer_phone as string | null) ?? null,
  });

  // Persist the merged context JSON so get_booking_summary reflects the confirmed values.
  // upsertSalonContext's ON CONFLICT path only updates booking_context_json + updated_at;
  // the status stays 'confirmed' (set by confirmSalonContext below).
  await upsertSalonContext(
    context.tenantId,
    context.call.id,
    context.session.id,
    { ...json, booking_status: 'confirmed' },
  );

  // Confirm voice context
  await confirmSalonContext(context.tenantId, context.session.id);

  return {
    success:             true,
    booking_id:          bookingId,
    status:              'confirmed',
    total_price_cents:   totalPriceCents,
    total_duration_min:  totalDurationMin,
    appointment_start:   appointmentStart,
    appointment_end:     appointmentEnd,
    stylist_id:          (json.selected_stylist_id as string | null) ?? null,
    service_count:       services.length,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds an ISO timestamp from a date string (YYYY-MM-DD) and time string (HH:MM).
 * Returns null when either is missing or malformed.
 */
function buildTimestamp(date: string, time: string): string | null {
  if (!date || !time) return null;
  const dateMatch = date.match(/^\d{4}-\d{2}-\d{2}$/);
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;
  return `${date}T${time.padStart(5, '0')}:00.000Z`;
}

function addMinutes(isoTimestamp: string, minutes: number): string {
  const d = new Date(isoTimestamp);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}
