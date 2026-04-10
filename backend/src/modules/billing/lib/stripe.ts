// src/modules/billing/lib/stripe.ts
//
// Stripe SDK singleton factory.
//
// Uses a module-level singleton so the SDK is initialised at most once per
// server process.  Tests that swap STRIPE_SECRET_KEY between runs should call
// resetStripe() to clear the cached instance.

import Stripe from 'stripe';
import { AppError } from '../../../errors/index.js';

let _stripe: Stripe | null = null;

/**
 * Returns the cached Stripe client, creating it on first call.
 * Throws immediately if secretKey is falsy.
 */
export function getStripe(secretKey: string): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });
  }
  return _stripe;
}

/**
 * Helper used by every billing endpoint / service function.
 * Throws 503 BILLING_DISABLED when STRIPE_SECRET_KEY is not configured.
 */
export function requireStripe(secretKey: string | undefined): Stripe {
  if (!secretKey) {
    throw new AppError(503, 'BILLING_DISABLED', 'Billing is not configured on this server (STRIPE_SECRET_KEY missing)');
  }
  return getStripe(secretKey);
}

/** Clears the cached instance — only used in tests. */
export function resetStripe(): void {
  _stripe = null;
}
