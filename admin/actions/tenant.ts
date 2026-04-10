'use server';

import { revalidatePath } from 'next/cache';
import { adminPost, adminDelete } from '../lib/backend';
import type { ActionResult } from '../lib/types';

// ── Plan ──────────────────────────────────────────────────────────────────────

export async function assignPlanAction(
  tenantId: string,
  plan: string,
): Promise<ActionResult> {
  try {
    await adminPost(`/tenants/${tenantId}/plan`, { plan });
    revalidatePath(`/tenants/${tenantId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ── Features ──────────────────────────────────────────────────────────────────

export async function enableFeatureAction(
  tenantId: string,
  feature: string,
): Promise<ActionResult> {
  try {
    await adminPost(`/tenants/${tenantId}/features/enable`, { feature });
    revalidatePath(`/tenants/${tenantId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function disableFeatureAction(
  tenantId: string,
  feature: string,
): Promise<ActionResult> {
  try {
    await adminPost(`/tenants/${tenantId}/features/disable`, { feature });
    revalidatePath(`/tenants/${tenantId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ── Domains ───────────────────────────────────────────────────────────────────

export async function enableDomainAction(
  tenantId: string,
  domain: string,
): Promise<ActionResult> {
  try {
    await adminPost(`/tenants/${tenantId}/domains/enable`, { domain });
    revalidatePath(`/tenants/${tenantId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function disableDomainAction(
  tenantId: string,
  domain: string,
): Promise<ActionResult> {
  try {
    await adminPost(`/tenants/${tenantId}/domains/disable`, { domain });
    revalidatePath(`/tenants/${tenantId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ── Limit overrides ───────────────────────────────────────────────────────────

export async function setLimitAction(
  tenantId: string,
  featureKey: string,
  limitType: string,
  limitValue: number | null,
): Promise<ActionResult> {
  try {
    await adminPost(`/tenants/${tenantId}/limits`, {
      feature_key: featureKey,
      limit_type:  limitType,
      limit_value: limitValue,
    });
    revalidatePath(`/tenants/${tenantId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function deleteLimitAction(
  tenantId: string,
  featureKey: string,
  limitType: string,
): Promise<ActionResult> {
  try {
    await adminDelete(`/tenants/${tenantId}/limits`, {
      feature_key: featureKey,
      limit_type:  limitType,
    });
    revalidatePath(`/tenants/${tenantId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
