// customer-ui/components/SubscriptionBadge.tsx
//
// Status badge for a Stripe subscription status value.

interface SubscriptionBadgeProps {
  status: string | null;
  cancelAtPeriodEnd?: boolean | null;
}

const STATUS_STYLES: Record<string, string> = {
  active:            'bg-green-50 text-green-700 ring-green-600/20',
  trialing:          'bg-blue-50 text-blue-700 ring-blue-600/20',
  past_due:          'bg-yellow-50 text-yellow-700 ring-yellow-600/20',
  canceled:          'bg-gray-100 text-gray-600 ring-gray-500/10',
  unpaid:            'bg-red-50 text-red-700 ring-red-600/20',
  incomplete:        'bg-orange-50 text-orange-700 ring-orange-600/20',
  incomplete_expired:'bg-gray-100 text-gray-600 ring-gray-500/10',
  paused:            'bg-gray-100 text-gray-600 ring-gray-500/10',
};

export function SubscriptionBadge({ status, cancelAtPeriodEnd }: SubscriptionBadgeProps) {
  if (!status) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-inset ring-gray-500/10">
        No subscription
      </span>
    );
  }

  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600 ring-gray-500/10';
  const label  = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}>
      {label}
      {cancelAtPeriodEnd && (
        <span className="text-[10px] opacity-75">(cancels at period end)</span>
      )}
    </span>
  );
}
