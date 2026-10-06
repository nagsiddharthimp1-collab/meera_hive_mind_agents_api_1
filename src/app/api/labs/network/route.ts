import { getLabsNetwork } from '@/lib/labsNetwork';
import { NextResponse } from 'next/server';

export async function GET() {
  const snapshot = await getLabsNetwork();
  if (!snapshot) return NextResponse.json({ available: false }, { status: 503 });
  return NextResponse.json(snapshot, {
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=300' },
  });
}
