import { stripeCheckoutReady } from '@/lib/stripePayments';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  const country = request.headers.get('x-vercel-ip-country')?.toUpperCase() ?? null;
  return NextResponse.json(
    {
      market: country === 'IN' ? 'india' : 'international',
      country,
      stripeReady: stripeCheckoutReady(),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
