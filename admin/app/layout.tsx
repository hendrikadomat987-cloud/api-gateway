import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Admin',
  description: 'Internal admin control panel',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-6 flex h-11 items-center gap-8">
            <span className="font-semibold tracking-tight text-gray-900">Admin</span>
            <div className="flex items-center gap-6 text-sm">
              <Link href="/tenants" className="text-gray-600 hover:text-gray-900 transition-colors">
                Tenants
              </Link>
              <Link href="/plans" className="text-gray-600 hover:text-gray-900 transition-colors">
                Plans
              </Link>
              <Link href="/billing" className="text-gray-600 hover:text-gray-900 transition-colors">
                Billing
              </Link>
            </div>
          </div>
        </nav>
        <main className="max-w-6xl mx-auto px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
