'use client';

import Link from 'next/link';

export default function TenantDetailError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <div className="bg-red-50 border border-red-200 rounded p-6">
      <h2 className="font-semibold text-red-900 mb-2">Failed to load tenant</h2>
      <p className="text-sm text-red-700 mb-4">{error.message}</p>
      <Link href="/tenants" className="text-sm text-blue-600 hover:underline">
        ← Back to tenant list
      </Link>
    </div>
  );
}
