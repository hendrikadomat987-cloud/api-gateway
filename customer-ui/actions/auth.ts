'use server';

// customer-ui/actions/auth.ts
//
// Login / logout Server Actions.
//
// Auth model (Phase 7 dummy):
//   - User provides their tenant JWT directly.
//   - We do a quick validation call to the backend to confirm it works.
//   - Valid token → stored in httpOnly cookie → redirect to /dashboard.
//   - Invalid token → return error message.
//
// This is intentionally a minimal "developer-friendly" auth that can be
// replaced with a proper Auth.js / Supabase Auth / Magic Link integration
// in a future phase.  The cookie contract (httpOnly, server-only) is
// already production-grade.

import { redirect } from 'next/navigation';
import { setToken, clearToken } from '../lib/auth';
import type { ActionResult } from '../lib/types';

/**
 * Validates a tenant JWT and stores it in the httpOnly cookie.
 *
 * Validation: calls GET /api/v1/features — lightweight, always authenticated.
 * If the backend returns 401 the token is rejected.
 */
export async function loginAction(formData: FormData): Promise<ActionResult> {
  const token = (formData.get('token') as string | null)?.trim() ?? '';

  if (!token) {
    return { success: false, error: 'Please enter your API token.' };
  }

  // Validate token against backend before storing it
  const backendUrl = (process.env.BACKEND_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  let valid = false;
  try {
    const res = await fetch(`${backendUrl}/api/v1/features`, {
      headers:  { Authorization: `Bearer ${token}` },
      cache:    'no-store',
    });
    valid = res.ok; // 200 = valid token; 401 = invalid
  } catch {
    return { success: false, error: 'Could not reach the backend. Check BACKEND_URL.' };
  }

  if (!valid) {
    return { success: false, error: 'Invalid or expired token. Please check and try again.' };
  }

  await setToken(token);
  redirect('/dashboard');
}

/**
 * Clears the session cookie and redirects to /login.
 */
export async function logoutAction(): Promise<void> {
  await clearToken();
  redirect('/login');
}
