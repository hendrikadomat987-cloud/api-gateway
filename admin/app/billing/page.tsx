import Link from 'next/link';
import { listTenants, getTenantDetail, getTenantBilling } from '../../lib/backend';
import type { TenantBillingDetail } from '../../lib/types';

export default async function BillingPage() {
  const { tenants } = await listTenants();

  const [detailResults, billingResults] = await Promise.all([
    Promise.allSettled(tenants.map(t => getTenantDetail(t.id))),
    Promise.allSettled(tenants.map(t => getTenantBilling(t.id))),
  ]);

  const rows = tenants.map((t, i) => ({
    tenant:  t,
    detail:  detailResults[i].status  === 'fulfilled' ? detailResults[i].value  : null,
    billing: billingResults[i].status === 'fulfilled' ? billingResults[i].value : null,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold mb-1">Billing</h1>
        <p className="text-sm text-gray-500">
          Stripe subscription state for all tenants.
        </p>
      </div>

      <div className="bg-white rounded border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-gray-500">
              <th className="px-4 py-3 font-medium">Tenant</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Stripe Customer</th>
              <th className="px-4 py-3 font-medium">Subscription</th>
              <th className="px-4 py-3 font-medium">Sub Status</th>
              <th className="px-4 py-3 font-medium">Period End</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ tenant, detail, billing }) => (
              <tr key={tenant.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{tenant.name || '—'}</div>
                  <div className="text-xs text-gray-400 font-mono">{tenant.id.slice(0, 8)}…</div>
                </td>
                <td className="px-4 py-3">
                  <TenantStatusBadge status={tenant.status} />
                </td>
                <td className="px-4 py-3">
                  {detail?.plan
                    ? <span className="font-medium">{detail.plan.key}</span>
                    : <em className="text-gray-400 text-xs">none</em>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600">
                  {billing?.stripe_customer_id
                    ? <span title={billing.stripe_customer_id}>{billing.stripe_customer_id.slice(0, 18)}…</span>
                    : <em className="text-gray-400">—</em>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600">
                  {billing?.stripe_subscription_id
                    ? <span title={billing.stripe_subscription_id}>{billing.stripe_subscription_id.slice(0, 18)}…</span>
                    : <em className="text-gray-400">—</em>}
                </td>
                <td className="px-4 py-3">
                  {billing?.status
                    ? <SubscriptionBadge billing={billing} />
                    : <em className="text-gray-400 text-xs">—</em>}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  {billing?.current_period_end
                    ? new Date(billing.current_period_end).toLocaleDateString()
                    : <em className="text-gray-400">—</em>}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/tenants/${tenant.id}`}
                    className="text-blue-600 hover:text-blue-800 text-xs"
                  >
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TenantStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active:    'bg-green-100 text-green-800',
    inactive:  'bg-gray-100 text-gray-600',
    suspended: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

function SubscriptionBadge({ billing }: { billing: TenantBillingDetail }) {
  const s = billing.status ?? '';
  const cancelingLabel = billing.cancel_at_period_end ? ' (canceling)' : '';

  const styles: Record<string, string> = {
    active:             'bg-green-100 text-green-800',
    trialing:           'bg-blue-100 text-blue-800',
    past_due:           'bg-amber-100 text-amber-800',
    unpaid:             'bg-red-100 text-red-800',
    canceled:           'bg-gray-100 text-gray-500',
    incomplete:         'bg-yellow-100 text-yellow-800',
    incomplete_expired: 'bg-gray-100 text-gray-500',
    paused:             'bg-gray-100 text-gray-600',
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${styles[s] ?? 'bg-gray-100 text-gray-600'}`}>
      {s}{cancelingLabel}
    </span>
  );
}
