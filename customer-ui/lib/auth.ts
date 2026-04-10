// customer-ui/lib/auth.ts
//
// Server-side cookie helpers for the tenant JWT.
//
// The token is stored in an httpOnly cookie — it is never readable
// from client-side JavaScript, never sent to the browser as JSON,
// and never stored in localStorage.
//
// Import only from Server Components, Server Actions, or Route Handlers.
// This module cannot be used in client ('use client') code.

import { cookies } from 'next/headers';

export const COOKIE_NAME    = 'tenant_token';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/**
 * Returns the tenant JWT from the httpOnly cookie, or null if not set.
 * Call from Server Components and Server Actions only.
 */
export async function getToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value ?? null;
}

/**
 * Sets the tenant JWT cookie.
 * Call from Server Actions only.
 */
export async function setToken(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly:  true,
    secure:    process.env.NODE_ENV === 'production',
    sameSite:  'lax',
    maxAge:    COOKIE_MAX_AGE,
    path:      '/',
  });
}

/**
 * Clears the tenant JWT cookie (logout).
 * Call from Server Actions only.
 */
export async function clearToken(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
