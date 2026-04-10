'use client';

/**
 * LimitOverrideForm — displays effective limits for a tenant and allows
 * setting or removing override values per (feature_key, limit_type) pair.
 *
 * An override with limit_value = null means "explicitly unlimited".
 * Deleting the override falls back to the plan default (or unlimited if no plan limit).
 */

import { useState, useTransition } from 'react';
import { setLimitAction, deleteLimitAction } from '../actions/tenant';
import type { TenantLimitRow } from '../lib/types';

interface Props {
  tenantId: string;
  limits:   TenantLimitRow[];
}

export function LimitOverrideForm({ tenantId, limits: initial }: Props) {
  const [limits, setLimits] = useState<TenantLimitRow[]>(initial);

  function handleUpdated(updated: TenantLimitRow) {
    setLimits(prev =>
      prev.some(l => l.feature_key === updated.feature_key && l.limit_type === updated.limit_type)
        ? prev.map(l =>
            l.feature_key === updated.feature_key && l.limit_type === updated.limit_type
              ? updated
              : l,
          )
        : [...prev, updated],
    );
  }

  function handleDeleted(featureKey: string, limitType: string) {
    setLimits(prev => prev.filter(
      l => !(l.feature_key === featureKey && l.limit_type === limitType),
    ));
  }

  return (
    <div className="space-y-4">
      {/* Existing limits table */}
      {limits.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="pb-1 pr-4 font-medium">Feature</th>
              <th className="pb-1 pr-4 font-medium">Type</th>
              <th className="pb-1 pr-4 font-medium">Value</th>
              <th className="pb-1 pr-4 font-medium">Source</th>
              <th className="pb-1 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {limits.map(l => (
              <LimitRow
                key={`${l.feature_key}:${l.limit_type}`}
                tenantId={tenantId}
                row={l}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
              />
            ))}
          </tbody>
        </table>
      )}

      {/* Add new override */}
      <AddOverrideRow
        tenantId={tenantId}
        onAdded={handleUpdated}
      />
    </div>
  );
}

// ── Existing limit row ────────────────────────────────────────────────────────

function LimitRow({
  tenantId,
  row,
  onUpdated,
  onDeleted,
}: {
  tenantId:  string;
  row:       TenantLimitRow;
  onUpdated: (r: TenantLimitRow) => void;
  onDeleted: (fk: string, lt: string) => void;
}) {
  const [editing, setEditing]            = useState(false);
  const [value, setValue]                = useState<string>(
    row.limit_value === null ? '' : String(row.limit_value),
  );
  const [error, setError]                = useState('');
  const [isPending, startTransition]     = useTransition();

  function handleSave() {
    setError('');
    const numericValue = value === '' ? null : Number(value);
    if (value !== '' && (isNaN(numericValue!) || numericValue! < 0 || !Number.isInteger(numericValue!))) {
      setError('Must be a non-negative integer or leave blank for unlimited');
      return;
    }
    startTransition(async () => {
      const result = await setLimitAction(tenantId, row.feature_key, row.limit_type, numericValue);
      if (result.success) {
        onUpdated({ ...row, limit_value: numericValue, source: 'override' });
        setEditing(false);
      } else {
        setError(result.error);
      }
    });
  }

  function handleDelete() {
    if (!confirm(`Remove override for ${row.feature_key} / ${row.limit_type}? The plan default will apply.`)) return;
    setError('');
    startTransition(async () => {
      const result = await deleteLimitAction(tenantId, row.feature_key, row.limit_type);
      if (result.success) {
        onDeleted(row.feature_key, row.limit_type);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <tr className="border-b border-gray-50">
      <td className="py-1 pr-4 font-mono text-gray-800">{row.feature_key}</td>
      <td className="py-1 pr-4 text-gray-600">{row.limit_type}</td>
      <td className="py-1 pr-4">
        {editing ? (
          <input
            type="number"
            min={0}
            step={1}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="blank = unlimited"
            className="border border-gray-300 rounded px-2 py-0.5 text-sm w-32"
            autoFocus
          />
        ) : (
          <span className={row.limit_value === null ? 'text-gray-400 italic' : ''}>
            {row.limit_value === null ? 'unlimited' : row.limit_value.toLocaleString()}
          </span>
        )}
      </td>
      <td className="py-1 pr-4">
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
          row.source === 'override' ? 'bg-amber-100 text-amber-800'
          : row.source === 'plan'   ? 'bg-blue-100 text-blue-800'
          : 'bg-gray-100 text-gray-600'
        }`}>
          {row.source}
        </span>
      </td>
      <td className="py-1">
        {editing ? (
          <span className="flex items-center gap-1">
            <button
              onClick={handleSave}
              disabled={isPending}
              className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded disabled:opacity-40"
            >
              {isPending ? '…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditing(false); setError(''); }}
              className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded"
            >
              Cancel
            </button>
            {error && <span className="text-red-600 text-xs">{error}</span>}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <button
              onClick={() => setEditing(true)}
              className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
            >
              Edit
            </button>
            {row.source === 'override' && (
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-40"
              >
                {isPending ? '…' : 'Delete'}
              </button>
            )}
            {error && <span className="text-red-600 text-xs">{error}</span>}
          </span>
        )}
      </td>
    </tr>
  );
}

// ── Add new override ──────────────────────────────────────────────────────────

function AddOverrideRow({
  tenantId,
  onAdded,
}: {
  tenantId: string;
  onAdded:  (r: TenantLimitRow) => void;
}) {
  const [featureKey, setFeatureKey]      = useState('');
  const [limitType, setLimitType]        = useState('tool_calls_per_month');
  const [value, setValue]                = useState('');
  const [error, setError]                = useState('');
  const [isPending, startTransition]     = useTransition();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const fk = featureKey.trim();
    if (!fk) return;
    const numericValue = value === '' ? null : Number(value);
    if (value !== '' && (isNaN(numericValue!) || numericValue! < 0 || !Number.isInteger(numericValue!))) {
      setError('Must be a non-negative integer or blank for unlimited');
      return;
    }
    setError('');
    startTransition(async () => {
      const result = await setLimitAction(tenantId, fk, limitType, numericValue);
      if (result.success) {
        onAdded({ feature_key: fk, limit_type: limitType, limit_value: numericValue, source: 'override' });
        setFeatureKey('');
        setValue('');
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleAdd} className="flex items-end gap-2 flex-wrap border-t border-gray-100 pt-3">
      <div>
        <label className="block text-xs text-gray-500 mb-0.5">Feature key</label>
        <input
          type="text"
          value={featureKey}
          onChange={e => setFeatureKey(e.target.value)}
          placeholder="e.g. voice.core"
          className="border border-gray-300 rounded px-2 py-1 text-sm font-mono w-44"
          disabled={isPending}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-0.5">Limit type</label>
        <input
          type="text"
          value={limitType}
          onChange={e => setLimitType(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-sm font-mono w-44"
          disabled={isPending}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-0.5">Value (blank = unlimited)</label>
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="unlimited"
          className="border border-gray-300 rounded px-2 py-1 text-sm w-28"
          disabled={isPending}
        />
      </div>
      <button
        type="submit"
        disabled={isPending || !featureKey.trim()}
        className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-40 transition-colors"
      >
        {isPending ? 'Setting…' : 'Set Override'}
      </button>
      {error && <span className="text-red-600 text-sm">{error}</span>}
    </form>
  );
}
