// src/modules/voice/tools/restaurant/order-rules.ts
//
// Stateless helpers for order price calculation and delivery validation.
// No direct DB access — DB interactions are delegated to repositories.

import { findDeliveryZone } from '../../repositories/restaurant-delivery.repository.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContextItem {
  line_total: number; // euros
}

export interface OrderTotals {
  subtotal_cents:     number;
  delivery_fee_cents: number;
  total_cents:        number;
}

export interface DeliveryValidation {
  valid:              boolean;
  error?:             string;
  delivery_fee_cents: number;
  min_order_cents?:   number;
}

// ── Price calculation ─────────────────────────────────────────────────────────

/**
 * Calculates order totals from context items and a known delivery fee.
 * All item line_totals already include modifier price deltas.
 */
export function calculateTotals(
  items: ContextItem[],
  deliveryFeeCents: number,
): OrderTotals {
  const subtotal_cents = Math.round(
    items.reduce((sum, item) => sum + item.line_total * 100, 0),
  );
  return {
    subtotal_cents,
    delivery_fee_cents: deliveryFeeCents,
    total_cents:        subtotal_cents + deliveryFeeCents,
  };
}

// ── Delivery validation ───────────────────────────────────────────────────────

/**
 * Validates that a delivery order is allowed:
 *   1. Postal code is in a known delivery zone
 *   2. Subtotal meets the minimum order requirement for that zone
 *
 * Returns the delivery fee when valid so the caller can store it.
 */
export async function validateDeliveryRules(
  tenantId: string,
  postalCode: string | undefined,
  subtotalCents: number,
): Promise<DeliveryValidation> {
  if (!postalCode) {
    return {
      valid:              false,
      error:              'delivery_postal_code_missing',
      delivery_fee_cents: 0,
    };
  }

  const zone = await findDeliveryZone(tenantId, postalCode);

  if (!zone) {
    return {
      valid:              false,
      error:              'delivery_zone_not_found',
      delivery_fee_cents: 0,
    };
  }

  if (subtotalCents < zone.min_order_cents) {
    return {
      valid:              false,
      error:              'min_order_not_met',
      delivery_fee_cents: zone.delivery_fee_cents,
      min_order_cents:    zone.min_order_cents,
    };
  }

  return {
    valid:              true,
    delivery_fee_cents: zone.delivery_fee_cents,
    min_order_cents:    zone.min_order_cents,
  };
}
