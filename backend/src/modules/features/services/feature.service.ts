// src/modules/features/services/feature.service.ts
//
// Central feature service for the Feature System V1.
//
// Usage:
//   import { featureService } from '.../features/services/feature.service.js';
//   const features = await featureService.getTenantFeatures(tenantId);
//   const allowed  = await featureService.hasFeature(tenantId, 'salon.booking');
//
// Caching: A simple per-process Map<tenantId, Set<featureKey>> is populated
// on first access and reused for subsequent calls within the same process.
// TTL: 60 seconds per tenant. This is intentionally lightweight — no external
// cache dependency. Feature changes (e.g. provisioning a new domain) take
// effect within 60 seconds without a restart.

import {
  getTenantFeatureKeys,
  hasTenantFeature,
  getTenantDomainKeys,
  provisionTenantDomain,
} from '../repositories/feature.repository.js';

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CacheEntry {
  features: Set<string>;
  domains:  string[];
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds
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

/** Evict a single tenant from the cache (e.g. after provisioning). */
export function invalidateTenantFeatureCache(tenantId: string): void {
  cache.delete(tenantId);
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Returns all enabled feature keys for a tenant.
 * Uses the in-process cache to avoid repeated DB round-trips.
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
 * Uses the same cache as getTenantFeatures.
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
 * Uses the in-process cache — avoids individual DB lookups per tool call.
 */
async function hasFeature(tenantId: string, featureKey: string): Promise<boolean> {
  const cached = getCached(tenantId);
  if (cached) return cached.features.has(featureKey);

  // No cache entry — fetch and populate, then check
  const features = await getTenantFeatures(tenantId);
  return features.includes(featureKey);
}

/**
 * Idempotently provisions a domain for a tenant and invalidates the cache.
 * Calls the repository function which handles all DB writes.
 */
async function provisionDomain(tenantId: string, domainKey: string): Promise<void> {
  await provisionTenantDomain(tenantId, domainKey);
  invalidateTenantFeatureCache(tenantId);
}

export const featureService = {
  getTenantFeatures,
  getTenantDomains,
  hasFeature,
  provisionDomain,
};
