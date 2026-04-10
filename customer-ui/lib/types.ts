// customer-ui/lib/types.ts
//
// Shared types matching backend API response shapes.

// ── Plan ─────────────────────────────────────────────────────────────────────

export interface PlanInfo {
  key:         string;
  name:        string;
  assigned_at: string;
}

// ── Usage ─────────────────────────────────────────────────────────────────────

export interface UsageItem {
  feature:    string;
  limit_type: string;
  count:      number;
  /** null = unlimited */
  limit:      number | null;
}

export interface UsageSummary {
  period_start: string;
  usage:        UsageItem[];
}

// ── Features ─────────────────────────────────────────────────────────────────

export interface FeatureSummary {
  features: string[];
  domains:  string[];
}

// ── Billing ───────────────────────────────────────────────────────────────────

export interface BillingStatus {
  stripe_customer_id:     string | null;
  stripe_subscription_id: string | null;
  stripe_price_id:        string | null;
  status:                 string | null;
  current_period_start:   string | null;
  current_period_end:     string | null;
  cancel_at_period_end:   boolean | null;
}

// ── Server Action results ─────────────────────────────────────────────────────

export type ActionResult =
  | { success: true;  message?: string }
  | { success: false; error: string };
