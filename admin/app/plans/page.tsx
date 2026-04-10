import { listPlans } from '../../lib/backend';
import type { PlanDetailRow } from '../../lib/types';

export default async function PlansPage() {
  const { plans } = await listPlans();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Plan Catalogue</h1>

      {plans.length === 0 ? (
        <p className="text-gray-400 italic">No plans defined.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {plans.map(plan => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan }: { plan: PlanDetailRow }) {
  return (
    <div className="bg-white rounded border border-gray-200 p-5 space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-gray-900">{plan.name}</h2>
          <span className="text-xs text-gray-400 font-mono">{plan.key}</span>
        </div>
      </div>

      {/* Domains */}
      <div>
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Domains</h3>
        {plan.domains.length === 0
          ? <span className="text-xs text-gray-400 italic">none</span>
          : (
            <div className="flex flex-wrap gap-1">
              {plan.domains.map(d => (
                <span key={d} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded font-mono">
                  {d}
                </span>
              ))}
            </div>
          )}
      </div>

      {/* Features */}
      <div>
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Features</h3>
        {plan.features.length === 0
          ? <span className="text-xs text-gray-400 italic">none</span>
          : (
            <div className="flex flex-wrap gap-1">
              {plan.features.map(f => (
                <span key={f} className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 rounded font-mono">
                  {f}
                </span>
              ))}
            </div>
          )}
      </div>

      {/* Limits */}
      <div>
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Limits</h3>
        {plan.limits.length === 0
          ? <span className="text-xs text-gray-400 italic">unlimited (no limits defined)</span>
          : (
            <table className="w-full text-xs">
              <tbody>
                {plan.limits.map(l => (
                  <tr key={`${l.feature_key}:${l.limit_type}`} className="border-b border-gray-50 last:border-0">
                    <td className="py-0.5 pr-2 font-mono text-gray-700">{l.feature_key}</td>
                    <td className="py-0.5 pr-2 text-gray-500">{l.limit_type}</td>
                    <td className="py-0.5 text-right font-medium">
                      {l.limit_value === null
                        ? <span className="text-gray-400 italic font-normal">∞</span>
                        : l.limit_value.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}
