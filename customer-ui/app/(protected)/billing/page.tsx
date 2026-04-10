// customer-ui/app/(protected)/billing/page.tsx
//
// Billing page: subscription status, create customer, subscribe, cancel.

'use client';

import { useState, useEffect, useTransition } from 'react';
import { SubscriptionBadge } from '../../../components/SubscriptionBadge';
import { ActionButton } from '../../../components/ActionButton';
import {
  createCustomerAction,
  subscribeAction,
  cancelAction,
} from '../../../actions/billing';
import type { ActionResult } from '../../../lib/types';
import type { BillingStatus } from '../../../lib/types';

// The billing page is a Client Component so it can handle interactive
// plan selection and display toast-style feedback.
// Billing data is fetched client-side via a lightweight API shim.

export default function BillingPage() {
  const [billing,   setBilling]   = useState<BillingStatus | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [message,   setMessage]   = useState<{ text: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  async function fetchBilling() {
    try {
      const res  = await fetch('/api/billing');
      const json = await res.json();
      if (json.success) setBilling(json.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchBilling(); }, []);

  function handleResult(result: ActionResult) {
    if (result.success) {
      setMessage({ text: result.message ?? 'Done.', ok: true });
      fetchBilling(); // refresh
    } else {
      setMessage({ text: result.error, ok: false });
    }
  }

  const hasCustomer     = !!billing?.stripe_customer_id;
  const hasSubscription = !!billing?.stripe_subscription_id;
  const isCanceling     = billing?.cancel_at_period_end === true;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your subscription and payment details.</p>
      </div>

      {/* Feedback banner */}
      {message && (
        <div
          className={`rounded-md p-4 text-sm ring-1 ring-inset ${
            message.ok
              ? 'bg-green-50 text-green-700 ring-green-600/20'
              : 'bg-red-50   text-red-700   ring-red-600/20'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Status card */}
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <dl className="space-y-4">
            <div className="flex justify-between text-sm">
              <dt className="text-gray-500">Status</dt>
              <dd>
                <SubscriptionBadge
                  status={billing?.status ?? null}
                  cancelAtPeriodEnd={billing?.cancel_at_period_end}
                />
              </dd>
            </div>
            {billing?.stripe_customer_id && (
              <div className="flex justify-between text-sm">
                <dt className="text-gray-500">Customer ID</dt>
                <dd className="font-mono text-xs text-gray-700">{billing.stripe_customer_id}</dd>
              </div>
            )}
            {billing?.stripe_subscription_id && (
              <div className="flex justify-between text-sm">
                <dt className="text-gray-500">Subscription ID</dt>
                <dd className="font-mono text-xs text-gray-700">{billing.stripe_subscription_id}</dd>
              </div>
            )}
            {billing?.current_period_end && (
              <div className="flex justify-between text-sm">
                <dt className="text-gray-500">
                  {isCanceling ? 'Cancels on' : 'Renews on'}
                </dt>
                <dd className="text-gray-900">
                  {new Date(billing.current_period_end).toLocaleDateString('en-US', {
                    month: 'long',
                    day:   'numeric',
                    year:  'numeric',
                  })}
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>

      {/* Actions */}
      {!loading && (
        <section className="space-y-4">
          {!hasCustomer && (
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="text-sm font-medium text-gray-900">Set up billing</h2>
              <p className="mt-1 text-sm text-gray-500">
                Create a billing account to subscribe to a plan.
              </p>
              <div className="mt-4">
                <ActionButton
                  action={createCustomerAction}
                  label="Create billing account"
                  loadingLabel="Creating…"
                  onResult={handleResult}
                />
              </div>
            </div>
          )}

          {hasCustomer && !hasSubscription && (
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="text-sm font-medium text-gray-900">Choose a plan</h2>
              <div className="mt-4 flex flex-wrap gap-3">
                {['starter', 'growth', 'pro'].map(plan => (
                  <ActionButton
                    key={plan}
                    action={() => subscribeAction(plan)}
                    label={`Subscribe to ${plan}`}
                    loadingLabel="Subscribing…"
                    onResult={handleResult}
                  />
                ))}
              </div>
            </div>
          )}

          {hasSubscription && !isCanceling && (
            <div className="rounded-lg border border-red-100 bg-white p-6">
              <h2 className="text-sm font-medium text-gray-900">Cancel subscription</h2>
              <p className="mt-1 text-sm text-gray-500">
                Your subscription will remain active until the end of the current billing period.
              </p>
              <div className="mt-4">
                <ActionButton
                  action={cancelAction}
                  label="Cancel subscription"
                  loadingLabel="Canceling…"
                  variant="danger"
                  onResult={handleResult}
                />
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
