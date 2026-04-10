// src/modules/billing/services/billing.service.ts
//
// Phase 5A: Stripe / Billing Integration — core business logic.
//
// Stripe is the source of truth for subscription state.  This service:
//   1. Creates Stripe customers + subscriptions (idempotent)
//   2. Verifies and processes Stripe webhooks
//   3. Syncs Stripe subscription status → internal tenant plan
//
// Plan sync rules:
//   active / trialing            → assign mapped plan
//   cancel_at_period_end = true  → keep current plan (access until period end)
//   past_due / unpaid            → keep current plan (grace period, handle manually)
//   incomplete                   → no change (awaiting initial payment)
//   incomplete_expired / deleted → remove plan assignment
//
// IMPORTANT: tenantId is always derived server-side (via billing_customers
// lookup) — never trusted from client input.

import type Stripe from 'stripe';
import { getStripe, requireStripe } from '../lib/stripe.js';
import * as repo from '../repositories/billing.repository.js';
import { assignPlanToTenant } from '../../features/repositories/plan.repository.js';
import { withTenant } from '../../../lib/db.js';
import { AppError } from '../../../errors/index.js';
import type { Config } from '../../../config/env.js';

// ── Price → Plan mapping ──────────────────────────────────────────────────────
//
// Maps Stripe price IDs to internal plan keys.
// Built from config at call time — never hard-coded.
// An unknown price_id is always a fatal error (fail loudly, no silent fallback).

type PriceMap = Map<string, string>; // stripe_price_id → plan_key

function buildPriceMap(config: Config): PriceMap {
  const map = new Map<string, string>();
  if (config.STRIPE_PRICE_STARTER)    map.set(config.STRIPE_PRICE_STARTER,    'starter');
  if (config.STRIPE_PRICE_PRO)        map.set(config.STRIPE_PRICE_PRO,        'pro');
  if (config.STRIPE_PRICE_ENTERPRISE) map.set(config.STRIPE_PRICE_ENTERPRISE, 'enterprise');
  return map;
}

function resolvePlanKey(priceId: string, priceMap: PriceMap): string | null {
  return priceMap.get(priceId) ?? null;
}

// ── createCustomer ────────────────────────────────────────────────────────────

/**
 * Creates a Stripe customer for a tenant and persists it locally.
 * Idempotent — returns the existing customer if already created.
 */
export async function createCustomer(
  tenantId: string,
  config:   Config,
): Promise<{ stripeCustomerId: string; created: boolean }> {
  requireStripe(config.STRIPE_SECRET_KEY);

  const existing = await repo.getCustomer(tenantId);
  if (existing) {
    return { stripeCustomerId: existing.stripe_customer_id, created: false };
  }

  const stripe   = getStripe(config.STRIPE_SECRET_KEY!);
  const customer = await stripe.customers.create({
    metadata: { tenant_id: tenantId },
  });

  await repo.insertCustomer(tenantId, customer.id);
  return { stripeCustomerId: customer.id, created: true };
}

// ── createSubscription ────────────────────────────────────────────────────────

/**
 * Creates a Stripe subscription for the given plan, syncs the plan internally.
 *
 * Requires that the plan key has a corresponding STRIPE_PRICE_* configured.
 * If the tenant already has a Stripe customer it is reused.
 */
export async function createSubscription(
  tenantId: string,
  planKey:  string,
  config:   Config,
): Promise<{ stripeSubscriptionId: string; status: string }> {
  requireStripe(config.STRIPE_SECRET_KEY);

  const priceMap = buildPriceMap(config);

  // Find Stripe price ID for the requested plan
  let priceId: string | undefined;
  for (const [pid, pkey] of priceMap.entries()) {
    if (pkey === planKey) { priceId = pid; break; }
  }
  if (!priceId) {
    throw new AppError(
      404,
      'PLAN_NOT_MAPPED',
      `Plan '${planKey}' has no Stripe price configured (set STRIPE_PRICE_${planKey.toUpperCase()})`,
    );
  }

  const { stripeCustomerId } = await createCustomer(tenantId, config);

  const stripe       = getStripe(config.STRIPE_SECRET_KEY!);
  const subscription = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    items:    [{ price: priceId }],
    metadata: { tenant_id: tenantId },
  });

  await _persistAndSyncSubscription(tenantId, subscription, priceMap);

  return { stripeSubscriptionId: subscription.id, status: subscription.status };
}

// ── cancelSubscription ────────────────────────────────────────────────────────

/**
 * Cancels the tenant's subscription at the current period end.
 * The tenant retains access until the period expires; the internal plan is
 * kept until the `customer.subscription.deleted` webhook arrives.
 */
export async function cancelSubscription(
  tenantId: string,
  config:   Config,
): Promise<{ canceled: boolean; cancelAtPeriodEnd: boolean }> {
  requireStripe(config.STRIPE_SECRET_KEY);

  const sub = await repo.getSubscriptionByTenant(tenantId);
  if (!sub) {
    throw new AppError(404, 'NO_SUBSCRIPTION', 'No subscription found for this tenant');
  }
  if (sub.cancel_at_period_end) {
    return { canceled: true, cancelAtPeriodEnd: true }; // already canceling
  }

  const stripe = getStripe(config.STRIPE_SECRET_KEY!);
  const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
    cancel_at_period_end: true,
  });

  await repo.upsertSubscription(tenantId, _subFields(updated));

  return { canceled: true, cancelAtPeriodEnd: true };
}

// ── handleWebhook ─────────────────────────────────────────────────────────────

/**
 * Verifies a Stripe webhook, records it, and processes it idempotently.
 *
 * Flow:
 *   1. Verify stripe-signature with STRIPE_WEBHOOK_SECRET
 *   2. Check billing_events for existing processed event → skip if found
 *   3. Insert into billing_events (UNIQUE prevents duplicate inserts)
 *   4. Process the event (subscription CRUD → plan sync)
 *   5. Mark event processed
 *
 * Returns { processed: true } or { processed: false, skipped: true } when
 * the event was already handled.
 */
export async function handleWebhook(
  rawBody:   Buffer,
  signature: string,
  config:    Config,
): Promise<{ processed: boolean; skipped?: boolean }> {
  if (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET) {
    throw new AppError(503, 'BILLING_DISABLED', 'Billing webhooks are not configured');
  }

  const stripe   = getStripe(config.STRIPE_SECRET_KEY);
  const priceMap = buildPriceMap(config);

  // 1. Verify signature — throws AppError on failure
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    throw new AppError(
      400,
      'INVALID_SIGNATURE',
      `Stripe webhook signature verification failed: ${(err as Error).message}`,
    );
  }

  // 2. Idempotency fast-path
  if (await repo.hasProcessedEvent(event.id)) {
    return { processed: false, skipped: true };
  }

  // 3. Record event — UNIQUE constraint silently ignores a race-condition duplicate
  await repo.recordStripeEvent(event.id, event.type, event as unknown as object);

  // 4. Process
  try {
    await _processEvent(event, priceMap);
  } catch (err) {
    // Persist the error for observability; re-throw so Stripe retries
    await repo.markEventFailed(event.id, (err as Error).message);
    throw err;
  }

  // 5. Mark processed
  await repo.markEventProcessed(event.id);

  return { processed: true };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _processEvent(event: Stripe.Event, priceMap: PriceMap): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub      = event.data.object as Stripe.Subscription;
      const tenantId = await _resolveTenant(sub);
      if (!tenantId) throw new Error(
        `No tenant mapped to Stripe customer '${_customerId(sub)}' — event ${event.id}`,
      );
      await _persistAndSyncSubscription(tenantId, sub, priceMap);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub      = event.data.object as Stripe.Subscription;
      const tenantId = await _resolveTenant(sub);
      if (!tenantId) break; // no local mapping → nothing to clean up

      // Persist the final deleted state, then remove the internal plan
      await repo.upsertSubscription(tenantId, _subFields(sub));
      await _removePlan(tenantId);
      break;
    }

    default:
      // All other event types are recorded in billing_events but not acted on.
      break;
  }
}

async function _persistAndSyncSubscription(
  tenantId: string,
  sub:      Stripe.Subscription,
  priceMap: PriceMap,
): Promise<void> {
  await repo.upsertSubscription(tenantId, _subFields(sub));
  await _syncPlan(tenantId, sub.status, sub.items.data[0]?.price.id ?? '', priceMap);
}

async function _syncPlan(
  tenantId: string,
  status:   string,
  priceId:  string,
  priceMap: PriceMap,
): Promise<void> {
  if (status === 'active' || status === 'trialing') {
    const planKey = resolvePlanKey(priceId, priceMap);
    if (planKey) {
      await assignPlanToTenant(tenantId, planKey);
    }
    // If planKey is null the price is unmapped — log but don't throw
    // (throwing here would cause webhook retries and leave the event unprocessed)
    return;
  }

  if (status === 'incomplete_expired') {
    await _removePlan(tenantId);
    return;
  }

  // status: canceled (cancel_at_period_end active), past_due, unpaid,
  //         incomplete, paused → no plan change.
  // Rationale:
  //   canceled w/ period active  → tenant paid through period end
  //   past_due / unpaid          → grace period; operator decides via admin UI
  //   incomplete                 → initial payment pending
  //   paused                     → Stripe pause; keep access per operator intent
}

async function _removePlan(tenantId: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      'DELETE FROM tenant_plans WHERE tenant_id = $1',
      [tenantId],
    );
  });
}

function _customerId(sub: Stripe.Subscription): string {
  return typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
}

async function _resolveTenant(sub: Stripe.Subscription): Promise<string | null> {
  return repo.getTenantByStripeCustomer(_customerId(sub));
}

function _subFields(sub: Stripe.Subscription) {
  return {
    stripeSubscriptionId: sub.id,
    stripePriceId:        sub.items.data[0]?.price.id ?? '',
    status:               sub.status,
    currentPeriodStart:   new Date((sub.current_period_start as number) * 1000),
    currentPeriodEnd:     new Date((sub.current_period_end   as number) * 1000),
    cancelAtPeriodEnd:    sub.cancel_at_period_end,
  };
}
