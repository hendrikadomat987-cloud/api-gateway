// customer-ui/lib/backend.ts
//
// Tenant-facing backend client.
//
// IMPORTANT: This module is server-only (Server Components + Server Actions).
// The tenant JWT is read from the httpOnly cookie per-call — it is never
// serialised into the response or sent to the browser.
//
// All API calls use the tenant JWT for authentication.  There is no
// ADMIN_TOKEN involved — the customer UI only accesses tenant-scoped APIs.

import { getToken } from './auth';
import type {
  PlanInfo,
  UsageSummary,
  FeatureSummary,
  BillingStatus,
} from './types';

// ── Core fetch ────────────────────────────────────────────────────────────────

function backendUrl() {
  return (process.env.BACKEND_URL ?? 'http://localhost:4000').replace(/\/$/, '');
}

interface BackendEnvelope<T> {
  success: boolean;
  data?:   T;
  error?:  { code: string; message: string };
}

/** Thrown when the backend returns 401 — caller should redirect to /login. */
export class AuthExpiredError extends Error {
  constructor() { super('Session expired — please log in again.'); }
}

export async function tenantFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();
  if (!token) throw new AuthExpiredError();

  const url = `${backendUrl()}/api/v1${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (res.status === 401) throw new AuthExpiredError();

  const body = (await res.json()) as BackendEnvelope<T>;
  if (!res.ok || !body.success) {
    throw new Error(body?.error?.message ?? `Backend returned HTTP ${res.status}`);
  }
  return body.data as T;
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export async function getCurrentPlan(): Promise<PlanInfo | null> {
  const data = await tenantFetch<{ plan: PlanInfo | null }>('/internal/plans/current');
  return data.plan;
}

// ── Usage ─────────────────────────────────────────────────────────────────────

export async function getCurrentUsage(): Promise<UsageSummary> {
  return tenantFetch<UsageSummary>('/usage/current');
}

// ── Features ─────────────────────────────────────────────────────────────────

export async function getFeatures(): Promise<FeatureSummary> {
  return tenantFetch<FeatureSummary>('/features');
}

// ── Billing ───────────────────────────────────────────────────────────────────

export async function getBillingStatus(): Promise<BillingStatus> {
  return tenantFetch<BillingStatus>('/internal/billing/subscriptions/current');
}

// ── Mutations (called from Server Actions) ────────────────────────────────────

export async function createBillingCustomer(): Promise<{ stripe_customer_id: string; created: boolean }> {
  return tenantFetch('/internal/billing/customers/create', { method: 'POST', body: '{}' });
}

export async function createSubscription(plan: string): Promise<{ stripe_subscription_id: string; status: string; plan: string }> {
  return tenantFetch('/internal/billing/subscriptions/create', {
    method: 'POST',
    body:   JSON.stringify({ plan }),
  });
}

export async function cancelSubscription(): Promise<{ canceled: boolean; cancelAtPeriodEnd: boolean }> {
  return tenantFetch('/internal/billing/subscriptions/cancel', { method: 'POST', body: '{}' });
}
