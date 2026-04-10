// customer-ui/app/page.tsx
//
// Root route: redirect to /dashboard (middleware guards auth).

import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/dashboard');
}
