// customer-ui/app/(protected)/settings/page.tsx
//
// Settings page: shows current token info (masked), logout button.

import { redirect } from 'next/navigation';
import { getToken } from '../../../lib/auth';
import { getFeatures } from '../../../lib/backend';
import { AuthExpiredError } from '../../../lib/backend';
import { logoutAction } from '../../../actions/auth';

function maskToken(token: string): string {
  if (token.length <= 16) return '••••••••';
  return token.slice(0, 8) + '••••••••••••' + token.slice(-4);
}

export default async function SettingsPage() {
  const token = await getToken();
  if (!token) redirect('/login');

  let domains: string[] = [];
  try {
    const features = await getFeatures();
    domains = features.domains ?? [];
  } catch (err) {
    if (err instanceof AuthExpiredError) redirect('/login');
    // non-fatal — show page without domain list
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Session and account details.</p>
      </div>

      {/* Token info */}
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-gray-900">API Token</h2>
        <div className="mt-3 flex items-center gap-3 rounded-md bg-gray-50 px-4 py-3">
          <span className="flex-1 font-mono text-sm text-gray-700 break-all">
            {maskToken(token)}
          </span>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Your token is stored in an httpOnly cookie and is never exposed to the browser.
        </p>
      </section>

      {/* Allowed domains */}
      {domains.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-gray-900">Allowed Domains</h2>
          <ul className="mt-3 space-y-1">
            {domains.map(d => (
              <li key={d} className="flex items-center gap-2 text-sm text-gray-700">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                {d}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sign out */}
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-gray-900">Sign out</h2>
        <p className="mt-1 text-sm text-gray-500">
          Clears your session cookie on this device.
        </p>
        <form action={logoutAction} className="mt-4">
          <button
            type="submit"
            className="rounded-md bg-red-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            Sign out
          </button>
        </form>
      </section>
    </div>
  );
}
