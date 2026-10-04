import { randomUUID } from 'crypto';
import { createSupabaseAdminClient } from '@/lib/meeraServer';
import { NextRequest, NextResponse } from 'next/server';

function deviceClass(userAgent: string): string {
  if (/tablet|ipad/i.test(userAgent)) return 'tablet';
  if (/mobile|iphone|android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.redirect(new URL('/', request.url));
  const { data: link } = await supabase
    .from('growth_links')
    .select('id, slug, destination_path, utm_source, utm_medium, utm_campaign, active, expires_at')
    .eq('slug', slug.toLowerCase())
    .maybeSingle();
  if (!link?.active || (link.expires_at && Date.parse(link.expires_at) <= Date.now())) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const visitorId = request.cookies.get('meera_growth_visitor')?.value ?? randomUUID();
  const referrer = request.headers.get('referer');
  let referrerHost: string | null = null;
  try {
    referrerHost = referrer ? new URL(referrer).hostname.slice(0, 160) : null;
  } catch {
    referrerHost = null;
  }
  await supabase.from('growth_link_clicks').insert({
    link_id: link.id,
    visitor_id: visitorId,
    referrer_host: referrerHost,
    device_class: deviceClass(request.headers.get('user-agent') ?? ''),
  });

  const destination = new URL(link.destination_path, request.nextUrl.origin);
  destination.searchParams.set('utm_source', link.utm_source);
  destination.searchParams.set('utm_medium', link.utm_medium);
  destination.searchParams.set('utm_campaign', link.utm_campaign);
  destination.searchParams.set('gl', link.slug);
  const response = NextResponse.redirect(destination);
  response.cookies.set('meera_growth_link', link.slug, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  response.cookies.set('meera_growth_visitor', visitorId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
