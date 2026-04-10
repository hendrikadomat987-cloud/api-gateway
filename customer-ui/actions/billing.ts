'use server';

// customer-ui/actions/billing.ts
//
// Billing Server Actions — called from the /billing page.
// All calls are tenant-scoped (JWT from httpOnly cookie).

import { revalidatePath } from 'next/cache';
import {
  createBillingCustomer,
  createSubscription,
  cancelSubscription,
} from '../lib/backend';
import { AuthExpiredError } from '../lib/backend';
import type { ActionResult } from '../lib/types';

/** Creates a Stripe customer for the current tenant. */
export async function createCustomerAction(): Promise<ActionResult> {
  try {
    await createBillingCustomer();
    revalidatePath('/billing');
    return { success: true, message: 'Billing account created.' };
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      return { success: false, error: 'Session expired — please log in again.' };
    }
    return { success: false, error: (err as Error).message ?? 'Failed to create billing account.' };
  }
}

/** Subscribes the current tenant to a plan. */
export async function subscribeAction(plan: string): Promise<ActionResult> {
  if (!plan) return { success: false, error: 'Plan is required.' };
  try {
    await createSubscription(plan);
    revalidatePath('/billing');
    return { success: true, message: `Subscribed to ${plan} plan.` };
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      return { success: false, error: 'Session expired — please log in again.' };
    }
    return { success: false, error: (err as Error).message ?? 'Failed to create subscription.' };
  }
}

/** Cancels the current tenant's subscription at period end. */
export async function cancelAction(): Promise<ActionResult> {
  try {
    await cancelSubscription();
    revalidatePath('/billing');
    return { success: true, message: 'Subscription will cancel at period end.' };
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      return { success: false, error: 'Session expired — please log in again.' };
    }
    return { success: false, error: (err as Error).message ?? 'Failed to cancel subscription.' };
  }
}
