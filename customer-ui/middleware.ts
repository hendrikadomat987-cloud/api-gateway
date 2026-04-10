// customer-ui/middleware.ts
//
// Cookie-based auth gate for the customer dashboard.
//
// The tenant JWT lives exclusively in the `tenant_token` httpOnly cookie.
// It is set by the login Server Action and never exposed to the browser.
//
// Flow:
//   - Public routes (/login, /_next/*, /favicon.ico) are always allowed.
//   - All other routes require the tenant_token cookie.
//   - Missing cookie → redirect to /login.

import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'tenant_token';

const PUBLIC_PATHS = ['/login'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow public paths and Next.js internals
  if (
    PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // Require token cookie for all other routes
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
