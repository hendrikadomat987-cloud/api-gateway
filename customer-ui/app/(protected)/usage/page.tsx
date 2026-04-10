// customer-ui/app/(protected)/usage/page.tsx
//
// Full usage breakdown for the current billing period.

import { redirect } from 'next/navigation';
import { getCurrentUsage } from '../../../lib/backend';
import { AuthExpiredError } from '../../../lib/backend';
import { UsageBar } from '../../../components/UsageBar';

export default async function UsagePage() {
  let usage = null;

  try {
    usage = await getCurrentUsage();
  } catch (err) {
    if (err instanceof AuthExpiredError) redirect('/login');
    throw err;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Usage</h1>
        {usage?.period_start ? (
          <p className="mt-1 text-sm text-gray-500">
            Billing period started{' '}
            {new Date(usage.period_start).toLocaleDateString('en-US', {
              month: 'long',
              day:   'numeric',
              year:  'numeric',
            })}
          </p>
        ) : (
          <p className="mt-1 text-sm text-gray-500">Current billing period</p>
        )}
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        {!usage || usage.usage.length === 0 ? (
          <p className="text-sm text-gray-500">No usage recorded for this period.</p>
        ) : (
          <div className="space-y-6">
            {usage.usage.map(item => (
              <UsageBar key={`${item.feature}:${item.limit_type}`} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
