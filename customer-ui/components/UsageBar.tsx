// customer-ui/components/UsageBar.tsx
//
// A single feature usage row with a progress bar.

import type { UsageItem } from '../lib/types';

interface UsageBarProps {
  item: UsageItem;
}

export function UsageBar({ item }: UsageBarProps) {
  const isUnlimited = item.limit === null;
  const pct = isUnlimited ? 0 : Math.min(100, Math.round((item.count / item.limit!) * 100));

  const barColor =
    pct >= 90 ? 'bg-red-500' :
    pct >= 70 ? 'bg-yellow-500' :
    'bg-blue-500';

  const label = item.feature.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-gray-500">
          {item.count.toLocaleString()}
          {isUnlimited ? ' / unlimited' : ` / ${item.limit!.toLocaleString()}`}
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        {isUnlimited ? (
          <div className="h-full w-full bg-gray-200" />
        ) : (
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {!isUnlimited && pct >= 90 && (
        <p className="mt-1 text-xs text-red-600">Approaching limit</p>
      )}
    </div>
  );
}
