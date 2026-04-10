// Shared TypeScript types — mirrors the backend admin repository shapes.

export interface TenantRow {
  id:         string;
  name:       string;
  status:     string;
  created_at: string;
}

export interface UsageSummaryItem {
  feature:    string;
  limit_type: string;
  count:      number;
  /** null = unlimited */
  limit:      number | null;
}

export interface TenantAdminDetail {
  id:       string;
  name:     string;
  status:   string;
  plan:     { key: string; name: string; assigned_at: string } | null;
  features: string[];
  domains:  string[];
  usage:    UsageSummaryItem[];
}

export interface PlanLimitRow {
  feature_key: string;
  limit_type:  string;
  /** null = unlimited */
  limit_value: number | null;
}

export interface PlanDetailRow {
  id:         string;
  key:        string;
  name:       string;
  created_at: string;
  domains:    string[];
  features:   string[];
  limits:     PlanLimitRow[];
}

export interface TenantLimitRow {
  feature_key: string;
  limit_type:  string;
  /** null = explicitly unlimited */
  limit_value: number | null;
  source:      'override' | 'plan' | 'none';
}

// ── Observability (Phase 6) ───────────────────────────────────────────────────

export interface RuntimeEventRow {
  id:          string;
  trace_id:    string;
  event_type:  string;
  tool_name:   string | null;
  feature_key: string | null;
  result:      string;
  error_code:  string | null;
  latency_ms:  number | null;
  payload:     Record<string, unknown>;
  created_at:  string;
}

export interface ErrorRateSummary {
  total_count:     number;
  error_count:     number;
  error_rate_pct:  number | null;
}

export interface FeatureUsageRow {
  feature_key: string;
  call_count:  number;
}

export interface LimitHitRow {
  feature_key:   string;
  blocked_count: number;
}

export interface TenantInsights {
  tenant_id:     string;
  recent_events: RuntimeEventRow[];
  error_rate:    ErrorRateSummary;
  top_features:  FeatureUsageRow[];
  limit_hits:    LimitHitRow[];
}

export interface TenantBillingDetail {
  tenant_id:              string;
  stripe_customer_id:     string | null;
  stripe_subscription_id: string | null;
  stripe_price_id:        string | null;
  status:                 string | null;
  current_period_start:   string | null;
  current_period_end:     string | null;
  cancel_at_period_end:   boolean | null;
}

export type ActionResult =
  | { success: true;  message?: string }
  | { success: false; error: string };
