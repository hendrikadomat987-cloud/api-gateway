// src/modules/voice/tools/salon/create-booking.tool.ts
//
// create_booking — creates a salon_bookings row and links it to the session
// via voice_salon_contexts.
//
// Idempotency: if an active draft already exists for this session, reuse it.
// Analogous to restaurant/create-order.tool.ts.

import type { VoiceContext } from '../../../../types/voice.js';
import { createSalonBooking } from '../../repositories/salon-bookings.repository.js';
import {
  findSalonContextBySessionId,
  upsertSalonContext,
} from '../../repositories/voice-salon-contexts.repository.js';
import { isDraftExpired } from './booking-guards.js';

export async function runCreateBooking(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const customerName  = typeof args.customer_name  === 'string' ? args.customer_name  : null;
  const customerPhone = typeof args.customer_phone === 'string' ? args.customer_phone : null;

  // ── Idempotency / state checks ─────────────────────────────────────────────

  const existing = await findSalonContextBySessionId(context.tenantId, context.session.id);

  if (existing) {
    const json      = existing.booking_context_json as Record<string, unknown>;
    const bookingId = json.salon_booking_id as string | undefined;

    // Guard: already confirmed — do not start a new booking over a confirmed one
    if (existing.status === 'confirmed') {
      return {
        success:    false,
        error:      'already_confirmed',
        booking_id: bookingId ?? 'unknown',
        message:    'This booking has already been confirmed. Start a new call to make a new booking.',
      };
    }

    // Reuse active non-expired draft
    if (existing.status === 'draft' && !isDraftExpired(existing)) {
      return {
        success:    true,
        booking_id: bookingId ?? 'unknown',
        status:     'reused',
        message:    'An active booking already exists for this session.',
      };
    }
  }

  // ── Create new booking ──────────────────────────────────────────────────────

  const bookingId = await createSalonBooking(context.tenantId, {
    source:        'voice',
    customerName,
    customerPhone,
  });

  await upsertSalonContext(
    context.tenantId,
    context.call.id,
    context.session.id,
    {
      salon_booking_id:    bookingId,
      selected_services:   [],
      selected_stylist_id: null,
      selected_date:       null,
      selected_time_slot:  null,
      customer_name:       customerName,
      customer_phone:      customerPhone,
      booking_status:      'draft',
    },
  );

  return {
    success:    true,
    booking_id: bookingId,
    status:     'created',
  };
}
