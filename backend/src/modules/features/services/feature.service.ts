// src/modules/features/services/feature.service.ts
//
// Central feature service for the Feature System V1 + V2.
//
// Caching: A simple per-process Map<tenantId, CacheEntry> is populated on first
// access and reused within the TTL window. Feature/domain changes invalidate the
// entry immediately — no stale data after a toggle operation.
//
// TTL: 60 seconds. Feature changes take effect at most 60 s later in other
// processes / pods. Within the process that performs the change, invalidation
// is immediate.

import {
  getTenantFeatureKeys,
  getTenantDomainKeys,
  getTenantFeatureDetails,
  getTenantDomainDetails,
  getTenantFeaturesWithSource,
  enableDomain   as dbEnableDomain,
  disableDomain  as dbDisableDomain,
  enableFeature  as dbEnableFeature,
  disableFeature as dbDisableFeature,
  provisionTenantDomain,
  type FeatureDetail,
  type FeatureDetailWithSource,
  type DomainDetail,
} from '../repositories/feature.repository.js';
import {
  assignPlanToTenant,
  getTenantPlan,
  type TenantPlanRow,
} from '../repositories/plan.repository.js';

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CacheEntry {
  features: Set<string>;
  domains:  string[];
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function getCached(tenantId: string): CacheEntry | undefined {
  const entry = cache.get(tenantId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(tenantId);
    return undefined;
  }
  return entry;
}

function setCached(tenantId: string, features: string[], domains: string[]): CacheEntry {
  const entry: CacheEntry = {
    features: new Set(features),
    domains,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  cache.set(tenantId, entry);
  return entry;
}

/** Evict a single tenant from the cache. Called after any state mutation. */
export function invalidateTenantFeatureCache(tenantId: string): void {
  cache.delete(tenantId);
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Returns all ENABLED feature keys for a tenant.
 * Results respect both tenant_features.enabled and domain state.
 */
async function getTenantFeatures(tenantId: string): Promise<string[]> {
  const cached = getCached(tenantId);
  if (cached) return [...cached.features];

  const [features, domains] = await Promise.all([
    getTenantFeatureKeys(tenantId),
    getTenantDomainKeys(tenantId),
  ]);
  const entry = setCached(tenantId, features, domains);
  return [...entry.features];
}

/**
 * Returns enabled domain keys for a tenant.
 * Uses the same cache entry as getTenantFeatures.
 */
async function getTenantDomains(tenantId: string): Promise<string[]> {
  const cached = getCached(tenantId);
  if (cached) return cached.domains;

  const [features, domains] = await Promise.all([
    getTenantFeatureKeys(tenantId),
    getTenantDomainKeys(tenantId),
  ]);
  setCached(tenantId, features, domains);
  return domains;
}

/**
 * Returns true when the tenant has the feature enabled.
 */
async function hasFeature(tenantId: string, featureKey: string): Promise<boolean> {
  const cached = getCached(tenantId);
  if (cached) return cached.features.has(featureKey);

  const features = await getTenantFeatures(tenantId);
  return features.includes(featureKey);
}

/**
 * Returns verbose feature details with source provenance (Phase 3).
 * Includes enabled and disabled features. Bypasses cache.
 */
async function getTenantFeaturesVerbose(tenantId: string): Promise<FeatureDetailWithSource[]> {
  return getTenantFeaturesWithSource(tenantId);
}

/**
 * Returns verbose domain details (all rows, including disabled).
 * Bypasses cache — always reads current DB state.
 */
async function getTenantDomainsVerbose(tenantId: string): Promise<DomainDetail[]> {
  return getTenantDomainDetails(tenantId);
}

// ── Domain management ─────────────────────────────────────────────────────────

/**
 * Enables a domain and all its features for a tenant.
 * Invalidates the cache immediately.
 */
async function enableDomain(tenantId: string, domainKey: string): Promise<void> {
  await dbEnableDomain(tenantId, domainKey);
  invalidateTenantFeatureCache(tenantId);
}

/**
 * Disables a domain and all its features for a tenant.
 * Invalidates the cache immediately.
 */
async function disableDomain(tenantId: string, domainKey: string): Promise<void> {
  await dbDisableDomain(tenantId, domainKey);
  invalidateTenantFeatureCache(tenantId);
}

// ── Feature management ────────────────────────────────────────────────────────

/**
 * Enables a single feature for a tenant.
 * Invalidates the cache immediately.
 */
async function enableFeature(tenantId: string, featureKey: string): Promise<void> {
  await dbEnableFeature(tenantId, featureKey);
  invalidateTenantFeatureCache(tenantId);
}

/**
 * Disables a single feature for a tenant.
 * Invalidates the cache immediately.
 */
async function disableFeature(tenantId: string, featureKey: string): Promise<void> {
  await dbDisableFeature(tenantId, featureKey);
  invalidateTenantFeatureCache(tenantId);
}

// ── Plan management ───────────────────────────────────────────────────────────

/**
 * Assigns a plan to a tenant and invalidates the feature cache.
 * Replaces any existing plan assignment.
 * Throws if the plan key does not exist.
 */
async function assignPlan(tenantId: string, planKey: string): Promise<void> {
  await assignPlanToTenant(tenantId, planKey);
  invalidateTenantFeatureCache(tenantId);
}

/**
 * Returns the current plan assignment for a tenant, or null if none.
 */
async function getCurrentPlan(tenantId: string): Promise<TenantPlanRow | null> {
  return getTenantPlan(tenantId);
}

// ── Provisioning ──────────────────────────────────────────────────────────────

/**
 * Idempotently provisions a domain for a tenant and invalidates the cache.
 */
async function provisionDomain(tenantId: string, domainKey: string): Promise<void> {
  await provisionTenantDomain(tenantId, domainKey);
  invalidateTenantFeatureCache(tenantId);
}

// ── Export ────────────────────────────────────────────────────────────────────

export const featureService = {
  // Read
  getTenantFeatures,
  getTenantDomains,
  hasFeature,
  getTenantFeaturesVerbose,
  getTenantDomainsVerbose,
  // Domain management
  enableDomain,
  disableDomain,
  // Feature management
  enableFeature,
  disableFeature,
  // Plan management
  assignPlan,
  getCurrentPlan,
  // Provisioning
  provisionDomain,
};
