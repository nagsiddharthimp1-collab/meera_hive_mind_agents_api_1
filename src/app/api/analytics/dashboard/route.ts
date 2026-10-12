import { requireAnalyticsPermission } from '@/lib/analyticsAccess';
import { matchesSegment } from '@/lib/analyticsDashboardMetrics';
import { loadDashboard, validateWindow } from '@/lib/analyticsDashboardServer';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const segment = request.nextUrl.searchParams.get('segment');
  const auth = await requireAnalyticsPermission(request, segment ? 'users.list' : 'analytics.view');
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  let window;
  try {
    window = validateWindow(request.nextUrl.searchParams.get('from'), request.nextUrl.searchParams.get('to'));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    const { details, ...dashboard } = await loadDashboard(auth.supabase, window.from, window.to);
    if (segment) {
      if (
        ![
          'all',
          'new',
          'active',
          'returning',
          'inactive',
          'paid',
          'free',
          'activated',
          'engaged',
          'repeat',
        ].includes(segment)
      )
        return NextResponse.json({ error: 'Unknown user segment.' }, { status: 400 });
      const source = request.nextUrl.searchParams.get('source'),
        query = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 100).toLowerCase();
      const pii = auth.permissions.includes('users.view_pii');
      const users = details
        .filter((u) => matchesSegment(u, segment) && (!source || u.source === source))
        .map((u) => ({ ...u, name: pii ? u.name : null, email: pii ? u.email : null }));
      const filtered = users
        .filter(
          (u) =>
            !query ||
            [
              u.id,
              u.name,
              u.email,
              u.source,
            ].some((v) => v?.toLowerCase().includes(query)),
        )
        .sort((a, b) => (b.messages ?? 0) - (a.messages ?? 0));
      const page = Math.max(0, Math.min(10000, Number(request.nextUrl.searchParams.get('page')) || 0));
      return NextResponse.json(
        { users: filtered.slice(page * 25, page * 25 + 25), total: filtered.length, page },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    return NextResponse.json(dashboard, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    console.error('[analytics-dashboard]', e instanceof Error ? e.message : 'unavailable');
    return NextResponse.json(
      { error: 'Product analytics could not be loaded. Please retry or choose a shorter range.' },
      { status: 503 },
    );
  }
}
