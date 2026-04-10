'use server';

import { revalidatePath } from 'next/cache';
import { adminPost } from '../lib/backend';
import type { ActionResult } from '../lib/types';

export async function resetUsageAction(
  tenantId: string,
  periodStart?: string,
): Promise<ActionResult> {
  try {
    const body: Record<string, string> = {};
    if (periodStart) body.period_start = periodStart;
    await adminPost(`/tenants/${tenantId}/usage/reset`, body);
    revalidatePath(`/tenants/${tenantId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
