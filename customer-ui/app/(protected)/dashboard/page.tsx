// customer-ui/app/(protected)/dashboard/page.tsx
//
// Overview page: plan, billing status, top usage items.

import { redirect } from 'next/navigation';
import { getCurrentPlan, getCurrentUsage, getBillingStatus } from '../../../lib/backend';
import { AuthExpiredError } from '../../../lib/backend';
import { PlanCard } from '../../../components/PlanCard';
import { UsageBar } from '../../../components/UsageBar';
import { SubscriptionBadge } from '../../../components/SubscriptionBadge';

export default async function DashboardPage() {
  let plan = null, usage = null, billing = null;

  try {
    [plan, usage, billing] = await Promise.all([
      getCurrentPlan(),
      getCurrentUsage(),
      getBillingStatus(),
    ]);
  } catch (err) {
    if (err instanceof AuthExpiredError) redirect('/login');
    throw err;
  }

  const topUsage = usage?.usage.slice(0, 3) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of your plan, billing status, and usage.
        </p>
      </div>

      {/* Plan */}
      <section>
        <PlanCard plan={plan} />
      </section>

      {/* Billing */}
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Subscription</p>
            <div className="mt-1">
              <SubscriptionBadge
                status={billing?.status ?? null}
                cancelAtPeriodEnd={billing?.cancel_at_period_end}
              />
            </div>
          </div>
          {billing?.current_period_end && (
            <div className="text-right">
              <p className="text-sm text-gray-500">Renews</p>
              <p className="text-sm font-medium text-gray-900">
                {new Date(billing.current_period_end).toLocaleDateString('en-US', {
                  month: 'short',
                  day:   'numeric',
                  year:  'numeric',
                })}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Top usage */}
      {topUsage.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-900">Usage this period</h2>
            <a href="/usage" className="text-sm text-blue-600 hover:underline">View all</a>
          </div>
          <div className="mt-4 space-y-4">
            {topUsage.map(item => (
              <UsageBar key={`${item.feature}:${item.limit_type}`} item={item} />
            ))}
          </div>
          {usage?.period_start && (
            <p className="mt-4 text-xs text-gray-400">
              Period started {new Date(usage.period_start).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
