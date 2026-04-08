// src/modules/voice/tools/salon/booking-guards.ts
//
// Shared guardrails for salon booking tools.
// Deterministic — no LLM, no silent defaults for unsafe inputs.

import type { VoiceSalonContext } from '../../repositories/voice-salon-contexts.repository.js';

// ── Consistent error shape ────────────────────────────────────────────────────

export interface BookingError {
  success: false;
  error:   string;
  message: string;
}

function err(code: string, message: string): BookingError {
  return { success: false, error: code, message };
}

// ── TTL ───────────────────────────────────────────────────────────────────────

/** A draft booking context not touched within this many minutes is considered expired. */
export const DRAFT_TTL_MINUTES = 60;

// ── State guards ──────────────────────────────────────────────────────────────

export function isBookingTerminal(ctx: VoiceSalonContext): boolean {
  return ctx.status === 'confirmed' || ctx.status === 'cancelled' || ctx.status === 'failed';
}

/**
 * Returns an error response when the booking is not in a mutable state.
 * Call this at the top of any mutation tool.
 */
export function guardDraftState(ctx: VoiceSalonContext): BookingError | null {
  if (!isBookingTerminal(ctx)) return null;
  if (ctx.status === 'confirmed') {
    return err('already_confirmed', 'This booking has already been confirmed and can no longer be modified.');
  }
  return err('booking_not_mutable', `Booking is in terminal state: ${ctx.status}.`);
}

/**
 * Returns an error when the draft context has expired.
 */
export function isDraftExpired(ctx: VoiceSalonContext): boolean {
  if (ctx.status !== 'draft') return false;
  const ageMs = Date.now() - new Date(ctx.updated_at).getTime();
  return ageMs > DRAFT_TTL_MINUTES * 60 * 1000;
}

export function guardExpiredDraft(ctx: VoiceSalonContext): BookingError | null {
  if (!isDraftExpired(ctx)) return null;
  return err(
    'booking_context_expired',
    `The booking session has expired after ${DRAFT_TTL_MINUTES} minutes of inactivity. Please start a new booking.`,
  );
}

// ── Service reference validation ──────────────────────────────────────────────

/** Returns an error when a service_id/reference is empty or missing. */
export function validateServiceRef(raw: unknown): BookingError | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return err('missing_service_reference', 'service_id is required.');
  }
  return null;
}

// ── Context completeness validation ───────────────────────────────────────────

/**
 * Validates that the booking context has the minimum required fields to confirm.
 * Returns error or null.
 */
export function validateBookingReadyToConfirm(
  json: Record<string, unknown>,
): BookingError | null {
  const services = (json.selected_services as unknown[] | undefined) ?? [];
  if (services.length === 0) {
    return err('empty_booking', 'Cannot confirm a booking with no services. Please add at least one service first.');
  }

  // Date and time slot are required for confirmation
  const date = json.selected_date as string | undefined;
  const slot = json.selected_time_slot as string | undefined;

  if (!date || date.trim().length === 0) {
    return err('missing_required_context', 'Please provide an appointment date before confirming.');
  }
  if (!slot || slot.trim().length === 0) {
    return err('missing_required_context', 'Please provide a time slot before confirming.');
  }

  return null;
}
