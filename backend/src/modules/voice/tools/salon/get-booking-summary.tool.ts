// src/modules/voice/tools/salon/get-booking-summary.tool.ts
//
// get_booking_summary — returns the current state of the active booking.
// Analogous to restaurant/get-order-summary.tool.ts.

import type { VoiceContext } from '../../../../types/voice.js';
import { findSalonContextBySessionId } from '../../repositories/voice-salon-contexts.repository.js';
import type { ContextService } from './booking-reference-resolver.js';

export async function runGetBookingSummary(
  context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  const ctx = await findSalonContextBySessionId(context.tenantId, context.session.id);

  if (!ctx) {
    return { success: false, error: 'no_active_booking', message: 'No active booking found.' };
  }

  const json      = ctx.booking_context_json as Record<string, unknown>;
  const bookingId = json.salon_booking_id as string | undefined;
  const services  = (json.selected_services as ContextService[] | undefined) ?? [];

  const totalPriceCents  = services.reduce((s, x) => s + x.price_cents, 0);
  const totalDurationMin = services.reduce((s, x) => s + x.duration_minutes, 0);

  return {
    success:             true,
    booking_id:          bookingId ?? null,
    status:              ctx.status,
    service_count:       services.length,
    services:            services.map((s) => ({
      id:               s.booking_service_id ?? s.item_id,
      name:             s.name,
      duration_minutes: s.duration_minutes,
      price:            s.price_cents / 100,
      price_cents:      s.price_cents,
    })),
    total_price_cents:   totalPriceCents,
    total_duration_min:  totalDurationMin,
    selected_date:       (json.selected_date       as string | null) ?? null,
    selected_time_slot:  (json.selected_time_slot  as string | null) ?? null,
    selected_stylist_id: (json.selected_stylist_id as string | null) ?? null,
    customer_name:       (json.customer_name       as string | null) ?? null,
    customer_phone:      (json.customer_phone      as string | null) ?? null,
  };
}
