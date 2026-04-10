// src/modules/billing/repositories/billing.repository.ts
//
// Database access for Phase 5A billing tables.
//
// billing_customers, billing_subscriptions, and billing_events have NO RLS —
// they are internal tables accessed only by the billing service, never through
// tenant-scoped queries.  All operations use pool.connect() directly.
//
// Idempotency:
//   • insertCustomer    — ON CONFLICT (tenant_id) DO UPDATE
//   • upsertSubscription — ON CONFLICT (stripe_subscription_id) DO UPDATE
//   • recordStripeEvent — ON CONFLICT (stripe_event_id) DO NOTHING

import { pool } from '../../../lib/db.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BillingCustomerRow {
  tenant_id:          string;
  stripe_customer_id: string;
  created_at:         string;
}

export interface BillingSubscriptionRow {
  id:                     string;
  tenant_id:              string;
  stripe_subscription_id: string;
  stripe_price_id:        string;
  status:                 string;
  current_period_start:   string;
  current_period_end:     string;
  cancel_at_period_end:   boolean;
  created_at:             string;
  updated_at:             string;
}

// ── Customers ─────────────────────────────────────────────────────────────────

/**
 * Returns the billing_customers row for a tenant, or null if none exists.
 */
export async function getCustomer(tenantId: string): Promise<BillingCustomerRow | null> {
  const client = await pool.connect();
  try {
    const r = await client.query<BillingCustomerRow>(
      `SELECT tenant_id::text, stripe_customer_id, created_at::text
       FROM billing_customers
       WHERE tenant_id = $1`,
      [tenantId],
    );
    return r.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/**
 * Upserts a billing_customers row.
 * Safe to call multiple times — re-returns the same row on conflict.
 */
export async function insertCustomer(
  tenantId:          string,
  stripeCustomerId:  string,
): Promise<BillingCustomerRow> {
  const client = await pool.connect();
  try {
    const r = await client.query<BillingCustomerRow>(
      `INSERT INTO billing_customers (tenant_id, stripe_customer_id)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE
         SET stripe_customer_id = EXCLUDED.stripe_customer_id
       RETURNING tenant_id::text, stripe_customer_id, created_at::text`,
      [tenantId, stripeCustomerId],
    );
    return r.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Returns the tenantId for a given Stripe customer ID, or null if unknown.
 * Used to derive tenantId from webhook subscription objects.
 */
export async function getTenantByStripeCustomer(stripeCustomerId: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    const r = await client.query<{ tenant_id: string }>(
      `SELECT tenant_id::text
       FROM billing_customers
       WHERE stripe_customer_id = $1`,
      [stripeCustomerId],
    );
    return r.rows[0]?.tenant_id ?? null;
  } finally {
    client.release();
  }
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

/**
 * Upserts a billing_subscriptions row keyed on stripe_subscription_id.
 * Called on every subscription webhook and on every local create/cancel action
 * — idempotent by design.
 */
export async function upsertSubscription(
  tenantId: string,
  sub: {
    stripeSubscriptionId: string;
    stripePriceId:        string;
    status:               string;
    currentPeriodStart:   Date;
    currentPeriodEnd:     Date;
    cancelAtPeriodEnd:    boolean;
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO billing_subscriptions (
         tenant_id, stripe_subscription_id, stripe_price_id, status,
         current_period_start, current_period_end, cancel_at_period_end
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (stripe_subscription_id) DO UPDATE SET
         tenant_id            = EXCLUDED.tenant_id,
         stripe_price_id      = EXCLUDED.stripe_price_id,
         status               = EXCLUDED.status,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end   = EXCLUDED.current_period_end,
         cancel_at_period_end = EXCLUDED.cancel_at_period_end`,
      [
        tenantId,
        sub.stripeSubscriptionId,
        sub.stripePriceId,
        sub.status,
        sub.currentPeriodStart,
        sub.currentPeriodEnd,
        sub.cancelAtPeriodEnd,
      ],
    );
  } finally {
    client.release();
  }
}

/**
 * Returns the most-recent billing_subscriptions row for a tenant, or null.
 */
export async function getSubscriptionByTenant(tenantId: string): Promise<BillingSubscriptionRow | null> {
  const client = await pool.connect();
  try {
    const r = await client.query<BillingSubscriptionRow>(
      `SELECT id::text, tenant_id::text, stripe_subscription_id, stripe_price_id,
              status, current_period_start::text, current_period_end::text,
              cancel_at_period_end, created_at::text, updated_at::text
       FROM billing_subscriptions
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId],
    );
    return r.rows[0] ?? null;
  } finally {
    client.release();
  }
}

// ── Events ─────────────────────────────────────────────────────────────────────

/**
 * Returns true if the event was already successfully processed.
 * Used for the idempotency fast-path before touching the DB.
 */
export async function hasProcessedEvent(stripeEventId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const r = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM billing_events
         WHERE stripe_event_id = $1
           AND processed_at IS NOT NULL
       ) AS exists`,
      [stripeEventId],
    );
    return r.rows[0].exists;
  } finally {
    client.release();
  }
}

/**
 * Inserts the raw Stripe event into billing_events.
 * ON CONFLICT DO NOTHING — safe to call on duplicate webhook deliveries.
 */
export async function recordStripeEvent(
  stripeEventId: string,
  type:          string,
  payload:       object,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO billing_events (stripe_event_id, type, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [stripeEventId, type, JSON.stringify(payload)],
    );
  } finally {
    client.release();
  }
}

/**
 * Stamps processed_at on a successfully handled event.
 */
export async function markEventProcessed(stripeEventId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE billing_events
       SET processed_at = now(), error = NULL
       WHERE stripe_event_id = $1`,
      [stripeEventId],
    );
  } finally {
    client.release();
  }
}

/**
 * Records a processing error against an event row (leaves processed_at NULL).
 */
export async function markEventFailed(stripeEventId: string, error: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE billing_events
       SET error = $2
       WHERE stripe_event_id = $1`,
      [stripeEventId, error],
    );
  } finally {
    client.release();
  }
}
