'use client';

/**
 * ManageList — manages a list of enabled features or domains for a tenant.
 *
 * - Shows each currently-enabled item with a Disable button.
 * - Provides an "Enable by key" input to activate new items.
 * - Calls Server Actions for mutations; revalidatePath refreshes the server data.
 */

import { useState, useTransition } from 'react';
import {
  enableFeatureAction,
  disableFeatureAction,
  enableDomainAction,
  disableDomainAction,
} from '../actions/tenant';

interface Props {
  tenantId: string;
  type:     'feature' | 'domain';
  enabled:  string[];
}

export function ManageList({ tenantId, type, enabled }: Props) {
  const [items, setItems]             = useState<string[]>(enabled);
  const [newKey, setNewKey]           = useState('');
  const [addError, setAddError]       = useState('');
  const [addPending, startAddTransition] = useTransition();

  const enableAction  = type === 'feature' ? enableFeatureAction  : enableDomainAction;
  const disableAction = type === 'feature' ? disableFeatureAction : disableDomainAction;

  async function handleEnable(e: React.FormEvent) {
    e.preventDefault();
    const key = newKey.trim();
    if (!key || items.includes(key)) return;
    setAddError('');
    startAddTransition(async () => {
      const result = await enableAction(tenantId, key);
      if (result.success) {
        setItems(prev => [...prev, key].sort());
        setNewKey('');
      } else {
        setAddError(result.error);
      }
    });
  }

  return (
    <div className="space-y-1">
      {items.length === 0 && (
        <p className="text-sm text-gray-400 italic">None enabled</p>
      )}
      {items.map(key => (
        <ItemRow
          key={key}
          itemKey={key}
          onDisable={async () => {
            const result = await disableAction(tenantId, key);
            if (result.success) setItems(prev => prev.filter(k => k !== key));
            return result;
          }}
        />
      ))}

      {/* Enable new item */}
      <form onSubmit={handleEnable} className="flex items-center gap-2 pt-2 border-t border-gray-100">
        <input
          type="text"
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          placeholder={`Add ${type} key…`}
          disabled={addPending}
          className="border border-gray-300 rounded px-2 py-1 text-sm font-mono w-56"
        />
        <button
          type="submit"
          disabled={addPending || !newKey.trim()}
          className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-40 transition-colors"
        >
          {addPending ? 'Enabling…' : 'Enable'}
        </button>
        {addError && <span className="text-red-600 text-xs">{addError}</span>}
      </form>
    </div>
  );
}

// ── Single item row ───────────────────────────────────────────────────────────

function ItemRow({
  itemKey,
  onDisable,
}: {
  itemKey:   string;
  onDisable: () => Promise<{ success: boolean; error?: string }>;
}) {
  const [error, setError]             = useState('');
  const [disabled, setDisabled]       = useState(false);
  const [isPending, startTransition]  = useTransition();

  if (disabled) return null;

  function handleDisable() {
    setError('');
    startTransition(async () => {
      const result = await onDisable();
      if (result.success) {
        setDisabled(true);
      } else {
        setError(result.error ?? 'Unknown error');
      }
    });
  }

  return (
    <div className="flex items-center gap-3 py-0.5">
      <span className="text-sm font-mono text-gray-800 min-w-56">{itemKey}</span>
      <button
        onClick={handleDisable}
        disabled={isPending}
        className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded hover:bg-red-100 hover:text-red-700 disabled:opacity-40 transition-colors"
      >
        {isPending ? '…' : 'Disable'}
      </button>
      {error && <span className="text-red-600 text-xs">{error}</span>}
    </div>
  );
}
