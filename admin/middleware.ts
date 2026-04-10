import { NextRequest, NextResponse } from 'next/server';

/**
 * HTTP Basic Auth gate for the entire admin UI.
 *
 * Auth model:
 *   - Credentials are stored in UI_USER / UI_PASSWORD server-side env vars.
 *   - ADMIN_TOKEN (used to call the backend) is held server-side in lib/backend.ts
 *     and is never sent to the browser.
 *   - The browser only ever sees the UI Basic Auth challenge and session cookies
 *     managed by the browser's Basic Auth cache.
 */
export function middleware(request: NextRequest) {
  const uiUser     = process.env.UI_USER     ?? 'admin';
  const uiPassword = process.env.UI_PASSWORD ?? '';

  // Deny all access when UI_PASSWORD is not configured — avoids open admin panels
  if (!uiPassword) {
    return new NextResponse('Admin UI not configured (UI_PASSWORD missing)', {
      status: 503,
    });
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const [scheme, credential = ''] = authHeader.split(' ');

  if (scheme === 'Basic' && credential) {
    let user = '';
    let pass = '';
    try {
      const decoded = atob(credential);
      const colon   = decoded.indexOf(':');
      user = decoded.slice(0, colon);
      pass = decoded.slice(colon + 1);
    } catch {
      // malformed base64 — fall through to 401
    }

    if (user === uiUser && pass === uiPassword) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Admin UI", charset="UTF-8"',
    },
  });
}

export const config = {
  // Run on every route except Next.js internals and static assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
