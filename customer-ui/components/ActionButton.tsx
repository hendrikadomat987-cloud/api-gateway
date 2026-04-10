'use client';

// customer-ui/components/ActionButton.tsx
//
// Client component with useTransition-based loading state.
// Wraps any Server Action that returns ActionResult.

import { useTransition } from 'react';
import type { ActionResult } from '../lib/types';

interface ActionButtonProps {
  /** The Server Action to call on click. */
  action: () => Promise<ActionResult>;
  /** Button label. */
  label: string;
  /** Label shown while the action is pending. */
  loadingLabel?: string;
  /** Tailwind colour variant for the button. */
  variant?: 'primary' | 'danger' | 'secondary';
  /** Called with the action result after it resolves. */
  onResult?: (result: ActionResult) => void;
}

const VARIANT_STYLES = {
  primary:   'bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-blue-600',
  danger:    'bg-red-600  text-white hover:bg-red-700  focus-visible:outline-red-600',
  secondary: 'bg-white    text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50',
};

export function ActionButton({
  action,
  label,
  loadingLabel,
  variant = 'primary',
  onResult,
}: ActionButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await action();
      onResult?.(result);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={`
        inline-flex items-center gap-2 rounded-md px-3.5 py-2.5 text-sm font-semibold
        shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
        disabled:cursor-not-allowed disabled:opacity-60
        ${VARIANT_STYLES[variant]}
      `}
    >
      {isPending && (
        <svg
          className="h-4 w-4 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      )}
      {isPending ? (loadingLabel ?? label) : label}
    </button>
  );
}
