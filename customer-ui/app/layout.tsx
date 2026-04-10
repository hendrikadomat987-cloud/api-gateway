// customer-ui/app/layout.tsx
//
// Root layout — no nav, just html/body with font and global styles.

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title:       'Voice Agent Dashboard',
  description: 'Manage your voice agent subscription and usage.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
