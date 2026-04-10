/**
 * Server-only backend client.
 *
 * IMPORTANT: This module is imported by Server Components and Server Actions
 * only — never from 'use client' code.  The ADMIN_TOKEN is read from the
 * server-side environment and is never serialised or sent to the browser.
 */

import type {
  TenantRow,
  TenantAdminDetail,
  TenantLimitRow,
  PlanDetailRow,
  TenantBillingDetail,
  TenantInsights,
} from './types';

// ── Core fetch wrapper ────────────────────────────────────────────────────────

// Read env vars per-call so tests can override them via process.env without
// suffering module-level capture at import time.
function backendUrl() {
  return (process.env.BACKEND_URL ?? 'http://localhost:4000').replace(/\/$/, '');
}
function adminToken() {
  return process.env.ADMIN_TOKEN ?? '';
}

interface BackendEnvelope<T> {
  success: boolean;
  data?:   T;
  error?:  { code: string; message: string };
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${backendUrl()}/api/v1/internal/admin${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${adminToken()}`,
      ...(init?.headers ?? {}),
    },
    // Always fetch fresh — admin operations must reflect current state
    cache: 'no-store',
  });

  const body = (await res.json()) as BackendEnvelope<T>;
  if (!res.ok || !body.success) {
    throw new Error(body?.error?.message ?? `Backend returned HTTP ${res.status}`);
  }
  return body.data as T;
}

// ── Tenant registry ───────────────────────────────────────────────────────────

export async function listTenants(): Promise<{ tenants: TenantRow[] }> {
  return adminFetch('/tenants');
}

export async function getTenantDetail(id: string): Promise<TenantAdminDetail> {
  return adminFetch(`/tenants/${id}`);
}

export async function getTenantLimits(id: string): Promise<{ tenant_id: string; limits: TenantLimitRow[] }> {
  return adminFetch(`/tenants/${id}/limits`);
}

// ── Plan catalogue ────────────────────────────────────────────────────────────

export async function listPlans(): Promise<{ plans: PlanDetailRow[] }> {
  return adminFetch('/plans');
}

// ── Billing ───────────────────────────────────────────────────────────────────

export async function getTenantBilling(id: string): Promise<TenantBillingDetail> {
  return adminFetch(`/tenants/${id}/billing`);
}

export async function getTenantInsights(id: string): Promise<TenantInsights> {
  return adminFetch(`/tenants/${id}/insights`);
}

// ── Mutation helpers (used by Server Actions) ─────────────────────────────────

export async function adminPost(path: string, body: unknown): Promise<void> {
  await adminFetch(path, {
    method: 'POST',
    body:   JSON.stringify(body),
  });
}

export async function adminDelete(path: string, body: unknown): Promise<void> {
  const url = `${backendUrl()}/api/v1/internal/admin${path}`;
  const res = await fetch(url, {
    method:  'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${adminToken()}`,
    },
    body:  JSON.stringify(body),
    cache: 'no-store',
  });
  const data = (await res.json()) as BackendEnvelope<unknown>;
  if (!res.ok || !data.success) {
    throw new Error(data?.error?.message ?? `Backend returned HTTP ${res.status}`);
  }
}
