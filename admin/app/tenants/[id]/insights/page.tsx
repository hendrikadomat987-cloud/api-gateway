import Link from 'next/link';
import { getTenantInsights, getTenantDetail } from '../../../../lib/backend';
import type { RuntimeEventRow } from '../../../../lib/types';

type Props = { params: Promise<{ id: string }> };

export default async function InsightsPage({ params }: Props) {
  const { id } = await params;

  const [insights, detail] = await Promise.all([
    getTenantInsights(id),
    getTenantDetail(id).catch(() => null),
  ]);

  const tenantName = detail?.name || id.slice(0, 8) + '…';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-gray-400 mb-1">
            <Link href={`/tenants/${id}`} className="hover:text-gray-600">← {tenantName}</Link>
          </div>
          <h1 className="text-xl font-semibold">Runtime Insights</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tool executions, gate decisions, and error rates for this tenant.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Events (24h)"
          value={String(insights.error_rate.total_count)}
          sub="total runtime events"
        />
        <StatCard
          label="Errors (24h)"
          value={String(insights.error_rate.error_count)}
          sub={insights.error_rate.error_rate_pct != null
            ? `${insights.error_rate.error_rate_pct}% error rate`
            : 'no activity'}
          highlight={
            insights.error_rate.error_rate_pct != null &&
            insights.error_rate.error_rate_pct > 10
          }
        />
        <StatCard
          label="Limit Hits"
          value={String(insights.limit_hits.reduce((s, r) => s + r.blocked_count, 0))}
          sub="total limit blocks"
          highlight={insights.limit_hits.length > 0}
        />
        <StatCard
          label="Top Feature"
          value={insights.top_features[0]?.feature_key?.split('.').pop() ?? '—'}
          sub={insights.top_features[0]
            ? `${insights.top_features[0].call_count} calls`
            : 'no data'}
        />
      </div>

      {/* Feature usage + Limit hits side by side */}
      <div className="grid grid-cols-2 gap-6">
        {/* Top features */}
        <div>
          <h2 className="text-base font-semibold mb-3">Feature Usage</h2>
          {insights.top_features.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No feature calls recorded yet.</p>
          ) : (
            <div className="bg-white rounded border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-left text-gray-500">
                    <th className="px-3 py-2 font-medium">Feature</th>
                    <th className="px-3 py-2 font-medium text-right">Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.top_features.map(f => (
                    <tr key={f.feature_key} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">{f.feature_key}</td>
                      <td className="px-3 py-2 text-right text-gray-900">{f.call_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Limit hits */}
        <div>
          <h2 className="text-base font-semibold mb-3">Limit Blocks</h2>
          {insights.limit_hits.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No limit blocks recorded.</p>
          ) : (
            <div className="bg-white rounded border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-left text-gray-500">
                    <th className="px-3 py-2 font-medium">Feature</th>
                    <th className="px-3 py-2 font-medium text-right">Blocked</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.limit_hits.map(h => (
                    <tr key={h.feature_key} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">{h.feature_key}</td>
                      <td className="px-3 py-2 text-right text-red-600 font-medium">{h.blocked_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Recent events */}
      <div>
        <h2 className="text-base font-semibold mb-3">Recent Events (last 20)</h2>
        {insights.recent_events.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No runtime events recorded yet.</p>
        ) : (
          <div className="bg-white rounded border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-gray-500">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Tool</th>
                  <th className="px-3 py-2 font-medium">Feature</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium text-right">ms</th>
                </tr>
              </thead>
              <tbody>
                {insights.recent_events.map(evt => (
                  <EventRow key={evt.id} event={evt} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  highlight = false,
}: {
  label:      string;
  value:      string;
  sub:        string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded border p-4 ${highlight ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${highlight ? 'text-red-700' : 'text-gray-900'}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-1">{sub}</div>
    </div>
  );
}

function EventRow({ event }: { event: RuntimeEventRow }) {
  const resultColors: Record<string, string> = {
    success: 'text-green-700 bg-green-50',
    error:   'text-red-700 bg-red-50',
    blocked: 'text-amber-700 bg-amber-50',
    allowed: 'text-blue-700 bg-blue-50',
  };
  const color = resultColors[event.result] ?? 'text-gray-600 bg-gray-50';
  const time  = new Date(event.created_at).toLocaleTimeString();

  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{time}</td>
      <td className="px-3 py-2 font-mono text-xs text-gray-600">{event.event_type}</td>
      <td className="px-3 py-2 text-xs text-gray-700">{event.tool_name ?? '—'}</td>
      <td className="px-3 py-2 font-mono text-xs text-gray-500">{event.feature_key ?? '—'}</td>
      <td className="px-3 py-2">
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>
          {event.result}
          {event.error_code ? ` (${event.error_code})` : ''}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-gray-400 text-right">
        {event.latency_ms != null ? event.latency_ms : '—'}
      </td>
    </tr>
  );
}
