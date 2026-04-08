// src/modules/voice/tools/salon/remove-booking-service.tool.ts
//
// remove_booking_service — removes a service from the active booking context.
// Analogous to restaurant/remove-order-item.tool.ts.

import type { VoiceContext } from '../../../../types/voice.js';
import { deleteSalonBookingService } from '../../repositories/salon-bookings.repository.js';
import {
  findSalonContextBySessionId,
  updateSalonContextJson,
} from '../../repositories/voice-salon-contexts.repository.js';
import { guardDraftState, guardExpiredDraft, validateServiceRef } from './booking-guards.js';
import {
  isUuid,
  resolveServiceReference,
  type ContextService,
} from './booking-reference-resolver.js';

export async function runRemoveBookingService(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const rawRef = args.service_id ?? args.reference;
  const ref    = typeof rawRef === 'string' ? rawRef.trim() : '';

  const refErr = validateServiceRef(ref);
  if (refErr) return refErr;

  // Load context
  const ctx = await findSalonContextBySessionId(context.tenantId, context.session.id);
  if (!ctx) return { success: false, error: 'no_active_booking', message: 'No active booking found.' };

  const stateErr = guardDraftState(ctx);
  if (stateErr) return stateErr;
  const expiredErr = guardExpiredDraft(ctx);
  if (expiredErr) return expiredErr;

  const json     = ctx.booking_context_json as Record<string, unknown>;
  const bookingId = json.salon_booking_id as string;
  const services = (json.selected_services as ContextService[] | undefined) ?? [];

  // Resolve reference
  let targetIndex: number;

  if (isUuid(ref)) {
    // Exact UUID match on booking_service_id or item_id
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
        message:    `Could not resolve reference '${ref}': ${resolved.error}`,
        candidates: resolved.candidates,
      };
    }
    targetIndex = resolved.index;
  }

  const removed = services[targetIndex];

  // Remove from DB
  if (removed.booking_service_id) {
    await deleteSalonBookingService(context.tenantId, removed.booking_service_id);
  }

  const updatedServices = services.filter((_, i) => i !== targetIndex);
  const totalPriceCents  = updatedServices.reduce((s, x) => s + x.price_cents, 0);
  const totalDurationMin = updatedServices.reduce((s, x) => s + x.duration_minutes, 0);

  const newJson = {
    ...json,
    selected_services: updatedServices,
  };

  const lockResult = await updateSalonContextJson(
    context.tenantId, context.session.id, newJson, ctx.updated_at,
  );
  if (lockResult === 'conflict') {
    return { success: false, error: 'concurrent_modification', message: 'Please retry.' };
  }

  return {
    success:             true,
    booking_id:          bookingId,
    status:              'service_removed',
    total_price_cents:   totalPriceCents,
    total_duration_min:  totalDurationMin,
    removed_service: {
      id:   removed.booking_service_id ?? removed.item_id,
      name: removed.name,
    },
  };
}
