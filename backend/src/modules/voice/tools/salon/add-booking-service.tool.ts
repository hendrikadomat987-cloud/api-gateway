// src/modules/voice/tools/salon/add-booking-service.tool.ts
//
// add_booking_service — adds a service to the active salon booking context.
// Auto-creates a booking context if none exists yet.
// Analogous to restaurant/add-order-item.tool.ts.

import type { VoiceContext } from '../../../../types/voice.js';
import { createSalonBooking, addSalonBookingService } from '../../repositories/salon-bookings.repository.js';
import {
  findSalonContextBySessionId,
  upsertSalonContext,
  updateSalonContextJson,
} from '../../repositories/voice-salon-contexts.repository.js';
import { findServiceById } from '../../repositories/salon-services.repository.js';
import {
  guardDraftState,
  guardExpiredDraft,
  validateServiceRef,
} from './booking-guards.js';
import {
  isUuid,
  isNochmalRef,
  type ContextService,
} from './booking-reference-resolver.js';

/** Dedup window: same service added within this many seconds is blocked. */
const DEDUP_WINDOW_SECONDS = 30;

export async function runAddBookingService(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const serviceId = typeof args.service_id === 'string' ? args.service_id.trim() : '';

  const refErr = validateServiceRef(serviceId);
  if (refErr) return refErr;

  return _doAddService(context, serviceId);
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function _doAddService(
  context: VoiceContext,
  serviceId: string,
  skipDedup = false,
): Promise<unknown> {
  // 1. Load or auto-create context
  let ctx = await findSalonContextBySessionId(context.tenantId, context.session.id);

  if (ctx) {
    const stateErr = guardDraftState(ctx);
    if (stateErr) return stateErr;
    const expiredErr = guardExpiredDraft(ctx);
    if (expiredErr) return expiredErr;
  }

  let bookingId: string;
  let services: ContextService[];

  if (!ctx) {
    bookingId = await createSalonBooking(context.tenantId, { source: 'voice' });
    ctx = await upsertSalonContext(
      context.tenantId, context.call.id, context.session.id,
      {
        salon_booking_id:  bookingId,
        selected_services: [],
        booking_status:    'draft',
        selected_stylist_id: null,
        selected_date:       null,
        selected_time_slot:  null,
        customer_name:       null,
        customer_phone:      null,
      },
    );
    services = [];
  } else {
    const json = ctx.booking_context_json as Record<string, unknown>;
    bookingId  = json.salon_booking_id as string;
    services   = (json.selected_services as ContextService[] | undefined) ?? [];
  }

  // 2. Dedup check (skip for nochmal repeats)
  if (!skipDedup && isUuid(serviceId) && ctx) {
    const json = ctx.booking_context_json as Record<string, unknown>;
    const fp   = json.last_add_fingerprint as { service_id: string; ts: string } | undefined;
    if (fp && fp.service_id === serviceId) {
      const ageSec = (Date.now() - new Date(fp.ts).getTime()) / 1000;
      if (ageSec < DEDUP_WINDOW_SECONDS) {
        return {
          success: false,
          error:   'duplicate_action_blocked',
          message: `The same service was just added ${Math.round(ageSec)}s ago. Please wait before adding again.`,
        };
      }
    }
  }

  // 3. Handle "nochmal" — clone last service
  if (isNochmalRef(serviceId)) {
    if (services.length === 0) {
      return { success: false, error: 'empty_booking', message: 'No service to repeat.' };
    }
    const last = services[services.length - 1];
    return _doAddService(context, last.item_id, true);
  }

  // 4. Resolve service from catalogue
  const service = isUuid(serviceId)
    ? await findServiceById(context.tenantId, serviceId)
    : null;

  if (!service && isUuid(serviceId)) {
    return { success: false, error: 'service_not_found', message: `Service '${serviceId}' not found or is inactive.` };
  }

  // 5. Persist to salon_booking_services
  let bookingServiceId: string | null = null;
  if (service) {
    bookingServiceId = await addSalonBookingService(context.tenantId, bookingId, {
      serviceId:       service.id,
      nameSnapshot:    service.name,
      durationMinutes: service.duration_minutes,
      priceCents:      service.price_cents,
    });
  }

  // 6. Build new context service
  const newService: ContextService = {
    booking_service_id: bookingServiceId,
    item_id:            service?.id ?? serviceId,
    name:               service?.name ?? serviceId,
    duration_minutes:   service?.duration_minutes ?? 0,
    unit_price:         service ? service.price_cents / 100 : 0,
    price_cents:        service?.price_cents ?? 0,
  };

  const updatedServices = [...services, newService];

  // 7. Calculate totals
  const totalPriceCents  = updatedServices.reduce((s, x) => s + x.price_cents, 0);
  const totalDurationMin = updatedServices.reduce((s, x) => s + x.duration_minutes, 0);

  // 8. Persist updated context (optimistic locking)
  const newJson = {
    ...(ctx.booking_context_json as Record<string, unknown>),
    selected_services:         updatedServices,
    last_added_service_id:     bookingServiceId ?? serviceId,
    last_add_fingerprint:      isUuid(serviceId)
      ? { service_id: serviceId, ts: new Date().toISOString() }
      : undefined,
  };

  if (ctx.updated_at) {
    const lockResult = await updateSalonContextJson(
      context.tenantId, context.session.id, newJson, ctx.updated_at,
    );
    if (lockResult === 'conflict') {
      return {
        success: false,
        error:   'concurrent_modification',
        message: 'The booking was modified by another request. Please retry.',
      };
    }
  } else {
    await upsertSalonContext(context.tenantId, context.call.id, context.session.id, newJson);
  }

  return {
    success:             true,
    booking_id:          bookingId,
    status:              'service_added',
    total_price_cents:   totalPriceCents,
    total_duration_min:  totalDurationMin,
    service: {
      id:               bookingServiceId ?? serviceId,
      service_id:       service?.id ?? null,
      name:             service?.name ?? serviceId,
      duration_minutes: service?.duration_minutes ?? 0,
      price:            service ? service.price_cents / 100 : 0,
      price_cents:      service?.price_cents ?? 0,
    },
  };
}
