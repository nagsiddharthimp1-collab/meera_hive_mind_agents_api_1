import { randomBytes } from 'crypto';
import { requireAnalyticsPermission, writeAnalyticsAudit } from '@/lib/analyticsAccess';
import { NextRequest, NextResponse } from 'next/server';

const PAID_STATUSES = new Set([
  'paid',
  'active',
  'success',
]);

type GrowthLinkRow = {
  id: string;
  slug: string;
  name: string;
  destination_path: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  active: boolean;
  expires_at: string | null;
  created_by_email: string;
  created_at: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
}

function normalizeDestination(value: unknown, origin: string): string | null {
  const raw = String(value ?? '/').trim() || '/';
  try {
    const parsed = new URL(raw, origin);
    const allowedHost = new URL(origin).hostname.replace(/^www\./, '');
    if (parsed.hostname.replace(/^www\./, '') !== allowedHost) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function parseWindow(request: NextRequest): { fromIso: string; toExclusiveIso: string } {
  const now = new Date();
  const fallbackFrom = new Date(now);
  fallbackFrom.setUTCDate(fallbackFrom.getUTCDate() - 30);
  const from = request.nextUrl.searchParams.get('from') ?? fallbackFrom.toISOString().slice(0, 10);
  const to = request.nextUrl.searchParams.get('to') ?? now.toISOString().slice(0, 10);
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const safeFrom = Number.isNaN(fromDate.getTime()) ? fallbackFrom : fromDate;
  const safeTo = Number.isNaN(toDate.getTime()) ? now : toDate;
  const toExclusive = new Date(safeTo);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  return { fromIso: safeFrom.toISOString(), toExclusiveIso: toExclusive.toISOString() };
}

export async function GET(request: NextRequest) {
  const auth = await requireAnalyticsPermission(request, 'growth_links.view');
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const { fromIso, toExclusiveIso } = parseWindow(request);
  const [
    linksResult,
    clicksResult,
    attributionsResult,
    openedResult,
    paymentsResult,
  ] = await Promise.all([
    auth.supabase.from('growth_links').select('*').order('created_at', { ascending: false }),
    auth.supabase
      .from('growth_link_clicks')
      .select('link_id, visitor_id, created_at')
      .gte('created_at', fromIso)
      .lt('created_at', toExclusiveIso)
      .limit(20000),
    auth.supabase
      .from('growth_link_attributions')
      .select('link_id, auth_user_id, attributed_at')
      .gte('attributed_at', fromIso)
      .lt('attributed_at', toExclusiveIso)
      .limit(10000),
    auth.supabase
      .from('analytics_events')
      .select('user_id')
      .eq('event_name', 'payment_page_opened')
      .gte('created_at', fromIso)
      .lt('created_at', toExclusiveIso)
      .limit(10000),
    auth.supabase
      .from('payments')
      .select('user_id, payment_status, amount, coupon_code, created_at')
      .gte('created_at', fromIso)
      .lt('created_at', toExclusiveIso)
      .limit(10000),
  ]);

  const firstError = [
    linksResult.error,
    clicksResult.error,
    attributionsResult.error,
    openedResult.error,
    paymentsResult.error,
  ].find(Boolean);
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

  const attributions = attributionsResult.data ?? [];
  const authIds = Array.from(new Set(attributions.map((row) => String(row.auth_user_id ?? '')).filter(Boolean)));
  const authToInternal = new Map<string, string>();
  for (let index = 0; index < authIds.length; index += 500) {
    const chunk = authIds.slice(index, index + 500);
    const { data, error } = await auth.supabase.from('users').select('id, auth_id').in('auth_id', chunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of data ?? []) {
      if (row.auth_id && row.id) authToInternal.set(String(row.auth_id), String(row.id));
    }
  }

  const openedAuthIds = new Set((openedResult.data ?? []).map((row) => String(row.user_id ?? '')).filter(Boolean));
  const paidByInternalId = new Map<string, number>();
  for (const payment of paymentsResult.data ?? []) {
    const status = String(payment.payment_status ?? '').toLowerCase();
    const coupon = String(payment.coupon_code ?? '').toUpperCase();
    const amount = Number(payment.amount ?? 0);
    if (!PAID_STATUSES.has(status) || coupon === 'BYPASS' || !Number.isFinite(amount) || amount <= 0) continue;
    const userId = String(payment.user_id ?? '');
    if (userId) paidByInternalId.set(userId, (paidByInternalId.get(userId) ?? 0) + amount);
  }

  const links = ((linksResult.data ?? []) as GrowthLinkRow[]).map((link) => {
    const clicks = (clicksResult.data ?? []).filter((row) => row.link_id === link.id);
    const linkAttributions = attributions.filter((row) => row.link_id === link.id);
    const attributedAuthIds = new Set(linkAttributions.map((row) => String(row.auth_user_id)));
    const paymentOpened = Array.from(attributedAuthIds).filter((id) => openedAuthIds.has(id)).length;
    let paid = 0;
    let revenue = 0;
    for (const authId of attributedAuthIds) {
      const internalId = authToInternal.get(authId);
      const amount = internalId ? (paidByInternalId.get(internalId) ?? 0) : 0;
      if (amount > 0) {
        paid += 1;
        revenue += amount;
      }
    }
    return {
      ...link,
      share_url: `${request.nextUrl.origin}/r/${link.slug}`,
      metrics: {
        clicks: clicks.length,
        unique_visitors: new Set(clicks.map((row) => row.visitor_id)).size,
        signups: attributedAuthIds.size,
        payment_opened: paymentOpened,
        paid,
        revenue,
        click_to_signup: clicks.length ? Number((attributedAuthIds.size / clicks.length).toFixed(4)) : 0,
      },
    };
  });

  return NextResponse.json({ links }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: NextRequest) {
  const auth = await requireAnalyticsPermission(request, 'growth_links.manage');
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = String(body?.name ?? '')
    .trim()
    .slice(0, 100);
  const destinationPath = normalizeDestination(body?.destination_path, request.nextUrl.origin);
  const utmSource = String(body?.utm_source ?? '')
    .trim()
    .slice(0, 80);
  const utmMedium = String(body?.utm_medium ?? '')
    .trim()
    .slice(0, 80);
  const utmCampaign = String(body?.utm_campaign ?? name)
    .trim()
    .slice(0, 100);
  const expiryRaw = String(body?.expires_at ?? '').trim();
  const expiresAt = expiryRaw ? new Date(expiryRaw) : null;
  if (!name || !destinationPath || !utmSource || !utmMedium || !utmCampaign) {
    return NextResponse.json(
      { error: 'Name, internal destination, source, medium and campaign are required.' },
      { status: 400 },
    );
  }
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json({ error: 'Expiry is invalid.' }, { status: 400 });
  }

  const baseSlug = slugify(String(body?.slug ?? name)) || 'campaign';
  const slug = `${baseSlug}-${randomBytes(3).toString('hex')}`;
  const { data, error } = await auth.supabase
    .from('growth_links')
    .insert({
      slug,
      name,
      destination_path: destinationPath,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      expires_at: expiresAt?.toISOString() ?? null,
      created_by_user_id: auth.user.id,
      created_by_email: auth.email,
    })
    .select('*')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Unable to create link.' }, { status: 500 });

  await writeAnalyticsAudit(auth, {
    action: 'growth_links.create',
    reason: 'Growth campaign link created',
    metadata: { link_id: data.id, slug: data.slug, destination_path: data.destination_path },
  });
  return NextResponse.json({ ...data, share_url: `${request.nextUrl.origin}/r/${data.slug}` }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAnalyticsPermission(request, 'growth_links.manage');
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  const body = (await request.json().catch(() => null)) as { id?: string; active?: boolean } | null;
  const id = String(body?.id ?? '').trim();
  if (!id || typeof body?.active !== 'boolean')
    return NextResponse.json({ error: 'Link id and active state are required.' }, { status: 400 });

  const { data, error } = await auth.supabase
    .from('growth_links')
    .update({ active: body.active, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Unable to update link.' }, { status: 500 });
  await writeAnalyticsAudit(auth, {
    action: body.active ? 'growth_links.enable' : 'growth_links.disable',
    reason: 'Growth campaign link status changed',
    metadata: { link_id: id, active: body.active },
  });
  return NextResponse.json(data);
}
