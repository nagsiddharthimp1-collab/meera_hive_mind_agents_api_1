import { requireAnalyticsPermission } from '@/lib/analyticsAccess';
import { loadAi, validateWindow } from '@/lib/analyticsDashboardServer';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const auth = await requireAnalyticsPermission(request, 'analytics.view');
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  let window;
  try {
    window = validateWindow(request.nextUrl.searchParams.get('from'), request.nextUrl.searchParams.get('to'));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    return NextResponse.json(await loadAi(auth.supabase, window.from, window.to), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (e) {
    console.error('[analytics-dashboard-ai]', e instanceof Error ? e.message : 'unavailable');
    return NextResponse.json(
      {
        error: 'AI telemetry could not be loaded. Product analytics remain available. Retry or choose a shorter range.',
      },
      { status: 503 },
    );
  }
}
