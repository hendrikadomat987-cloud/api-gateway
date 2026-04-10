'use client';

import { useState, useTransition } from 'react';
import { assignPlanAction } from '../actions/tenant';
import type { ActionResult } from '../lib/types';

interface Props {
  tenantId:       string;
  currentPlan:    string | null;
  availablePlans: string[];
}

export function AssignPlanForm({ tenantId, currentPlan, availablePlans }: Props) {
  const [selected, setSelected]   = useState(currentPlan ?? '');
  const [result, setResult]       = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setResult(null);
    startTransition(async () => {
      const r = await assignPlanAction(tenantId, selected);
      setResult(r);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3 flex-wrap">
      <select
        value={selected}
        onChange={e => setSelected(e.target.value)}
        disabled={isPending}
        className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
      >
        <option value="">— select plan —</option>
        {availablePlans.map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending || !selected || selected === currentPlan}
        className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-40 transition-colors"
      >
        {isPending ? 'Saving…' : 'Assign Plan'}
      </button>
      {result && (
        <span className={result.success ? 'text-green-700 text-sm' : 'text-red-600 text-sm'}>
          {result.success ? '✓ Plan assigned' : `Error: ${result.error}`}
        </span>
      )}
    </form>
  );
}
