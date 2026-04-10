// customer-ui/components/PlanCard.tsx
//
// Displays the tenant's current plan details.

import type { PlanInfo } from '../lib/types';

interface PlanCardProps {
  plan: PlanInfo | null;
}

export function PlanCard({ plan }: PlanCardProps) {
  if (!plan) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-sm text-gray-500">No plan assigned.</p>
      </div>
    );
  }

  const assignedDate = new Date(plan.assigned_at).toLocaleDateString('en-US', {
    year:  'numeric',
    month: 'long',
    day:   'numeric',
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">Current Plan</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{plan.name}</p>
        </div>
        <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
          {plan.key}
        </span>
      </div>
      <p className="mt-4 text-sm text-gray-500">Assigned {assignedDate}</p>
    </div>
  );
}
