import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenantDetail, getTenantLimits, listPlans } from '../../../lib/backend';
import { AssignPlanForm }     from '../../../components/AssignPlanForm';
import { ManageList }         from '../../../components/ManageList';
import { LimitOverrideForm }  from '../../../components/LimitOverrideForm';
import { UsageResetButton }   from '../../../components/UsageResetButton';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function TenantDetailPage({ params }: Props) {
  const { id } = await params;

  let detail, limitsData, plansData;
  try {
    [detail, limitsData, plansData] = await Promise.all([
      getTenantDetail(id),
      getTenantLimits(id),
      listPlans(),
    ]);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('404') || msg.includes('NOT_FOUND')) notFound();
    throw err;
  }

  const availablePlans = plansData.plans.map(p => p.key);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/tenants" className="text-blue-600 hover:text-blue-800 text-sm">
          ← Tenants
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-semibold">{detail.name || 'Unnamed tenant'}</h1>
        <StatusBadge status={detail.status} />
      </div>

      {/* Tenant meta */}
      <Section title="Identity">
        <Dl>
          <Dt>ID</Dt>
          <Dd><span className="font-mono text-sm">{detail.id}</span></Dd>
          <Dt>Name</Dt>
          <Dd>{detail.name || <em className="text-gray-400">—</em>}</Dd>
          <Dt>Status</Dt>
          <Dd><StatusBadge status={detail.status} /></Dd>
        </Dl>
      </Section>

      {/* Plan */}
      <Section title="Plan">
        <div className="space-y-3">
          <Dl>
            <Dt>Current plan</Dt>
            <Dd>
              {detail.plan
                ? <><span className="font-medium">{detail.plan.name}</span> <span className="text-gray-400 text-xs">({detail.plan.key})</span></>
                : <em className="text-gray-400">None assigned</em>}
            </Dd>
            {detail.plan && (
              <>
                <Dt>Assigned</Dt>
                <Dd className="text-gray-500 text-sm">
                  {new Date(detail.plan.assigned_at).toLocaleDateString('en-GB', {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </Dd>
              </>
            )}
          </Dl>
          <AssignPlanForm
            tenantId={id}
            currentPlan={detail.plan?.key ?? null}
            availablePlans={availablePlans}
          />
        </div>
      </Section>

      {/* Domains */}
      <Section title="Domains">
        <ManageList tenantId={id} type="domain" enabled={detail.domains} />
      </Section>

      {/* Features */}
      <Section title="Features">
        <ManageList tenantId={id} type="feature" enabled={detail.features} />
      </Section>

      {/* Limits */}
      <Section title="Limits &amp; Overrides">
        <p className="text-xs text-gray-400 mb-3">
          Source <span className="bg-amber-100 text-amber-800 px-1 rounded">override</span> means a
          tenant-specific value is in effect.{' '}
          <span className="bg-blue-100 text-blue-800 px-1 rounded">plan</span> means the plan default applies.
          Editing any row sets an override.
        </p>
        <LimitOverrideForm tenantId={id} limits={limitsData.limits} />
      </Section>

      {/* Usage */}
      <Section title="Current-period Usage">
        {detail.usage.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No usage recorded this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="pb-1 pr-4 font-medium">Feature</th>
                <th className="pb-1 pr-4 font-medium">Type</th>
                <th className="pb-1 pr-4 font-medium">Used</th>
                <th className="pb-1 font-medium">Limit</th>
              </tr>
            </thead>
            <tbody>
              {detail.usage.map(u => (
                <tr key={`${u.feature}:${u.limit_type}`} className="border-b border-gray-50">
                  <td className="py-1.5 pr-4 font-mono text-gray-800">{u.feature}</td>
                  <td className="py-1.5 pr-4 text-gray-600">{u.limit_type}</td>
                  <td className="py-1.5 pr-4">
                    <span className={
                      u.limit !== null && u.count >= u.limit
                        ? 'text-red-600 font-medium'
                        : ''
                    }>
                      {u.count.toLocaleString()}
                    </span>
                  </td>
                  <td className="py-1.5">
                    {u.limit === null
                      ? <span className="text-gray-400 italic text-xs">unlimited</span>
                      : <>
                          {u.limit.toLocaleString()}
                          {u.limit > 0 && (
                            <span className="ml-2 text-gray-400 text-xs">
                              ({Math.round((u.count / u.limit) * 100)}%)
                            </span>
                          )}
                        </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Usage reset */}
      <Section title="Usage Reset">
        <p className="text-sm text-gray-500 mb-3">
          Clears all usage counters for the current billing period.
          This is a destructive action and cannot be undone.
        </p>
        <UsageResetButton tenantId={id} />
      </Section>
    </div>
  );
}

// ── Layout helpers ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Dl({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">{children}</dl>;
}

function Dt({ children }: { children: React.ReactNode }) {
  return <dt className="text-gray-500">{children}</dt>;
}

function Dd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dd className={`text-gray-900 ${className ?? ''}`}>{children}</dd>;
}

function StatusBadge({ status }: { status: string }) {
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
