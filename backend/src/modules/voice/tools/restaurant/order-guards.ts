// src/modules/voice/tools/restaurant/order-guards.ts
//
// Shared guardrails for restaurant order tools.
// All checks are deterministic — no LLM, no silent defaults for unsafe inputs.

import type { VoiceOrderContext } from '../../../../types/voice.js';

// ── Consistent error shape ────────────────────────────────────────────────────

export interface OrderError {
  success: false;
  error:   string;
  message: string;
}

function err(code: string, message: string): OrderError {
  return { success: false, error: code, message };
}

// ── State guards ──────────────────────────────────────────────────────────────

/** Returns true when the order context is in a terminal (non-editable) state. */
export function isOrderTerminal(ctx: VoiceOrderContext): boolean {
  return ctx.status === 'confirmed' || ctx.status === 'cancelled' || ctx.status === 'failed';
}

/**
 * Returns an error response if the order is not in draft state, null otherwise.
 * Call this at the top of any mutation tool (add/update/remove).
 */
export function guardDraftState(ctx: VoiceOrderContext): OrderError | null {
  if (!isOrderTerminal(ctx)) return null;
  return err(
    'order_already_confirmed',
    'This order has already been confirmed and can no longer be modified.',
  );
}

// ── Quantity validation ───────────────────────────────────────────────────────

/**
 * Validates that a quantity argument is a positive integer.
 * Returns an error object when invalid, null when valid.
 * Accepts undefined (optional quantity).
 */
export function validateQuantity(
  raw: unknown,
  required = false,
): OrderError | null {
  if (raw === undefined || raw === null) {
    return required ? err('missing_quantity', 'quantity is required.') : null;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return err('invalid_quantity', `quantity must be a number, got ${typeof raw}.`);
  }
  if (!Number.isInteger(raw)) {
    return err('invalid_quantity', `quantity must be an integer, got ${raw}.`);
  }
  if (raw <= 0) {
    return err('invalid_quantity', `quantity must be > 0, got ${raw}.`);
  }
  return null;
}

// ── Delivery validation ───────────────────────────────────────────────────────

/** Validates the delivery_type argument. Returns error or null. */
export function validateDeliveryType(raw: unknown): OrderError | null {
  if (raw === undefined || raw === null) return null; // optional; caller defaults to 'pickup'
  if (raw !== 'pickup' && raw !== 'delivery') {
    return err(
      'invalid_delivery_type',
      `delivery_type must be "pickup" or "delivery", got "${raw}".`,
    );
  }
  return null;
}

// ── Reference validation ──────────────────────────────────────────────────────

/** Returns an error when item_id/reference is empty or missing. */
export function validateItemRef(raw: unknown): OrderError | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return err('missing_item_reference', 'item_id is required.');
  }
  return null;
}
