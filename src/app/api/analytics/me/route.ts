import { NextRequest, NextResponse } from 'next/server';
import { requireAnalyticsPermission } from '@/lib/analyticsAccess';

export async function GET(request: NextRequest) {
  const auth = await requireAnalyticsPermission(request, 'analytics.view');
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  return NextResponse.json(
    {
      email: auth.email,
      role: auth.role,
      permissions: auth.permissions,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
