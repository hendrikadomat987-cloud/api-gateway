// customer-ui/app/api/billing/route.ts
//
// Thin server-side Route Handler so the billing Client Component can
// fetch billing status without exposing the tenant JWT to the browser.

import { NextResponse } from 'next/server';
import { getBillingStatus } from '../../../lib/backend';
import { AuthExpiredError } from '../../../lib/backend';

export async function GET() {
  try {
    const data = await getBillingStatus();
    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      return NextResponse.json({ success: false, error: 'Session expired' }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
