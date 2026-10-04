import { requireAnalyticsPermission } from '@/lib/analyticsAccess';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const auth = await requireAnalyticsPermission(request, 'analytics.view');
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  const { data, error } = await auth.supabase
    .from('users')
    .select('created_at')
    .not('email', 'is', null)
    .not('created_at', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    from: data?.created_at ? String(data.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10),
  });
}
