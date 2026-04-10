'use client';

/**
 * UsageResetButton — dangerous action button with a double-click confirmation.
 *
 * First click: button turns red and asks "Click again to confirm reset".
 * Second click within 5 seconds: executes the reset.
 * If no second click within 5 seconds: reverts to the default state.
 */

import { useState, useTransition, useEffect } from 'react';
import { resetUsageAction } from '../actions/usage';

interface Props {
  tenantId: string;
}

export function UsageResetButton({ tenantId }: Props) {
  const [confirming, setConfirming]     = useState(false);
  const [result, setResult]             = useState<{ success: boolean; error?: string } | null>(null);
  const [isPending, startTransition]    = useTransition();

  // Auto-cancel confirmation after 5 s
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(timer);
  }, [confirming]);

  function handleClick() {
    if (!confirming) {
      setConfirming(true);
      setResult(null);
      return;
    }

    setConfirming(false);
    startTransition(async () => {
      const r = await resetUsageAction(tenantId);
      setResult(r);
    });
  }

  if (isPending) {
    return <button disabled className="px-3 py-1 bg-gray-300 text-gray-600 text-sm rounded">Resetting…</button>;
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleClick}
        className={`px-3 py-1 text-sm rounded transition-colors ${
          confirming
            ? 'bg-red-600 text-white hover:bg-red-700 animate-pulse'
            : 'bg-gray-100 text-gray-700 hover:bg-red-100 hover:text-red-700 border border-gray-200'
        }`}
      >
        {confirming ? 'Click again to confirm reset' : 'Reset Usage Counters'}
      </button>
      {confirming && (
        <span className="text-xs text-gray-400">Auto-cancels in 5s</span>
      )}
      {result && !confirming && (
        <span className={result.success ? 'text-green-700 text-sm' : 'text-red-600 text-sm'}>
          {result.success ? '✓ Usage counters reset' : `Error: ${result.error}`}
        </span>
      )}
    </div>
  );
}
