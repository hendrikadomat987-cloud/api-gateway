// src/modules/voice/tools/salon/update-booking-service.tool.ts
//
// update_booking_service — replaces a service in the active booking with a
// different service from the catalogue.
// (Hair salon services are "swap, not quantity-adjust" unlike restaurant items.)

import type { VoiceContext } from '../../../../types/voice.js';
import {
  deleteSalonBookingService,
  addSalonBookingService,
} from '../../repositories/salon-bookings.repository.js';
import {
  findSalonContextBySessionId,
  updateSalonContextJson,
} from '../../repositories/voice-salon-contexts.repository.js';
import { findServiceById } from '../../repositories/salon-services.repository.js';
import { guardDraftState, guardExpiredDraft, validateServiceRef } from './booking-guards.js';
import {
  isUuid,
  resolveServiceReference,
  type ContextService,
} from './booking-reference-resolver.js';

export async function runUpdateBookingService(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  // service_id = the reference to the service to replace (positional / UUID / name)
  // new_service_id = the new service UUID to put in its place
  const rawRef      = args.service_id ?? args.reference;
  const ref         = typeof rawRef === 'string' ? rawRef.trim() : '';
  const newServiceId = typeof args.new_service_id === 'string' ? args.new_service_id.trim() : '';

  const refErr = validateServiceRef(ref);
  if (refErr) return refErr;

  if (!newServiceId) {
    return { success: false, error: 'missing_new_service_id', message: 'new_service_id is required.' };
  }

  // Load context
  const ctx = await findSalonContextBySessionId(context.tenantId, context.session.id);
  if (!ctx) return { success: false, error: 'no_active_booking', message: 'No active booking found.' };

  const stateErr = guardDraftState(ctx);
  if (stateErr) return stateErr;
  const expiredErr = guardExpiredDraft(ctx);
  if (expiredErr) return expiredErr;

  const json      = ctx.booking_context_json as Record<string, unknown>;
  const bookingId = json.salon_booking_id as string;
  const services  = (json.selected_services as ContextService[] | undefined) ?? [];

  // Resolve reference to find the item being replaced
  let targetIndex: number;

  if (isUuid(ref)) {
    targetIndex = services.findIndex(
      (s) => s.booking_service_id === ref || s.item_id === ref,
    );
    if (targetIndex === -1) {
      return { success: false, error: 'invalid_service_reference', message: `Service '${ref}' not found in booking.` };
    }
  } else {
    const resolved = resolveServiceReference(services, ref);
    if (resolved.error) {
      return {
        success:    false,
        error:      resolved.error,
        candidates: resolved.candidates,
      };
    }
    targetIndex = resolved.index;
  }

  const old = services[targetIndex];

  // Resolve the new service from catalogue
  const newService = await findServiceById(context.tenantId, newServiceId);
  if (!newService) {
    return { success: false, error: 'service_not_found', message: `New service '${newServiceId}' not found.` };
  }

  // Delete old DB row, insert new
  if (old.booking_service_id) {
    await deleteSalonBookingService(context.tenantId, old.booking_service_id);
  }

  const newBookingServiceId = await addSalonBookingService(context.tenantId, bookingId, {
    serviceId:       newService.id,
    nameSnapshot:    newService.name,
    durationMinutes: newService.duration_minutes,
    priceCents:      newService.price_cents,
  });

  const newContextService: ContextService = {
    booking_service_id: newBookingServiceId,
    item_id:            newService.id,
    name:               newService.name,
    duration_minutes:   newService.duration_minutes,
    unit_price:         newService.price_cents / 100,
    price_cents:        newService.price_cents,
  };

  const updatedServices = services.map((s, i) => (i === targetIndex ? newContextService : s));
  const totalPriceCents  = updatedServices.reduce((s, x) => s + x.price_cents, 0);
  const totalDurationMin = updatedServices.reduce((s, x) => s + x.duration_minutes, 0);

  const newJson = { ...json, selected_services: updatedServices };

  const lockResult = await updateSalonContextJson(
    context.tenantId, context.session.id, newJson, ctx.updated_at,
  );
  if (lockResult === 'conflict') {
    return { success: false, error: 'concurrent_modification', message: 'Please retry.' };
  }

  return {
    success:            true,
    booking_id:         bookingId,
    status:             'service_updated',
    total_price_cents:  totalPriceCents,
    total_duration_min: totalDurationMin,
    service: {
      id:               newBookingServiceId,
      service_id:       newService.id,
      name:             newService.name,
      duration_minutes: newService.duration_minutes,
      price:            newService.price_cents / 100,
      price_cents:      newService.price_cents,
    },
  };
}
