-- =============================================================================
-- Migration: 20260410000005_billing_v1.sql
-- Phase 5A: Stripe / Billing Integration
--
-- Creates three tables that hold billing state alongside the internal plan
-- system.  Stripe is the source of truth for subscription state; these tables
-- are the local mirror.  No RLS is applied — billing tables are internal-only
-- and are accessed by the billing service (not per-tenant queries).
--
-- Idempotency guarantees:
--   • UNIQUE on stripe_customer_id    → customer creation is idempotent
--   • UNIQUE on stripe_subscription_id → subscription upsert is idempotent
--   • UNIQUE on stripe_event_id       → webhook processing is idempotent
-- =============================================================================

-- =============================================================================
-- billing_customers — maps each tenant to a Stripe customer
-- =============================================================================

CREATE TABLE IF NOT EXISTS billing_customers (
  tenant_id          UUID        NOT NULL PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_customer_id TEXT        NOT NULL UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_customers_stripe_id
  ON billing_customers (stripe_customer_id);

-- =============================================================================
-- billing_subscriptions — current Stripe subscription state per tenant
--
-- One active row per tenant is the expected steady state (Stripe also sends
-- history through webhooks but we only store the latest state via upsert on
-- stripe_subscription_id).
--
-- status values mirror Stripe's subscription.status field:
--   active | trialing | canceled | past_due | unpaid |
--   incomplete | incomplete_expired | paused
-- We deliberately omit a CHECK constraint so new Stripe statuses don't break
-- existing rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id                      UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_subscription_id  TEXT        NOT NULL UNIQUE,
  stripe_price_id         TEXT        NOT NULL,
  status                  TEXT        NOT NULL,
  current_period_start    TIMESTAMPTZ NOT NULL,
  current_period_end      TIMESTAMPTZ NOT NULL,
  cancel_at_period_end    BOOLEAN     NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_tenant_id
  ON billing_subscriptions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_stripe_id
  ON billing_subscriptions (stripe_subscription_id);

-- Auto-update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION trg_fn_billing_subscriptions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_subscriptions_updated_at ON billing_subscriptions;
CREATE TRIGGER trg_billing_subscriptions_updated_at
  BEFORE UPDATE ON billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION trg_fn_billing_subscriptions_updated_at();

-- =============================================================================
-- billing_events — idempotency log for Stripe webhook events
--
-- Every incoming Stripe event is inserted here before processing.
-- The UNIQUE constraint on stripe_event_id prevents double-processing under
-- concurrent webhook retries.
--
-- processed_at IS NULL  → event received but not yet processed (or failed)
-- processed_at IS NOT NULL → successfully processed
-- error IS NOT NULL     → last processing attempt failed with this message
-- =============================================================================

CREATE TABLE IF NOT EXISTS billing_events (
  id              UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT        NOT NULL UNIQUE,
  type            TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  processed_at    TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_unprocessed
  ON billing_events (created_at)
  WHERE processed_at IS NULL;
