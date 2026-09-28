import { requireAnalyticsPermission } from '@/lib/analyticsAccess';
import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_ALLOWED_DOMAIN = (process.env.ANALYTICS_ALLOWED_EMAIL_DOMAIN ?? 'himeera.com').trim().toLowerCase();
const EXCLUDED_ANALYTICS_EMAIL_DOMAINS = (
  process.env.ANALYTICS_EXCLUDED_EMAIL_DOMAINS ??
  `example.com,example.net,example.org,example.invalid,invalid,local,localhost,${DEFAULT_ALLOWED_DOMAIN}`
)
  .split(',')
  .map((value) => value.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);
const EXCLUDED_ANALYTICS_EMAILS = (process.env.ANALYTICS_EXCLUDED_EMAILS ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const EXCLUDED_ANALYTICS_EMAIL_PREFIXES = (
  process.env.ANALYTICS_EXCLUDED_EMAIL_PREFIXES ?? 'codex-,test-,smoke-,e2e-,qa-'
)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const EXCLUDED_ANALYTICS_NAME_PREFIXES = (process.env.ANALYTICS_EXCLUDED_NAME_PREFIXES ?? 'codex,memory keyword smoke')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const EXCLUDED_ANALYTICS_ID_FRAGMENTS = (process.env.ANALYTICS_EXCLUDED_ID_FRAGMENTS ?? 'bypass,smoke,codex,test,e2e')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const BYPASS_COUPON_CODES = (process.env.ANALYTICS_BYPASS_COUPON_CODES ?? process.env.PAYMENT_BYPASS_CODES ?? 'BYPASS')
  .split(',')
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);

function parseDateParam(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function addDaysUtc(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDayStartIsoUtc(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const auth = await requireAnalyticsPermission(request, 'analytics.view');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message ?? 'Unauthorized' }, { status: auth.status });
  }

  const now = new Date();
  const fromDate = parseDateParam(request.nextUrl.searchParams.get('from'), addDaysUtc(now, -30));
  const toDate = parseDateParam(request.nextUrl.searchParams.get('to'), now);
  const normalizedFromDate = new Date(
    Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()),
  );
  const normalizedToDate = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate()));

  if (normalizedToDate < normalizedFromDate) {
    return NextResponse.json({ error: '`to` must be on or after `from`' }, { status: 400 });
  }

  const fromIso = toDayStartIsoUtc(normalizedFromDate);
  const toExclusiveIso = toDayStartIsoUtc(addDaysUtc(normalizedToDate, 1));

  try {
    const { data, error } = await auth.supabase.rpc('analytics_executive_summary', {
      p_from: fromIso,
      p_to: toExclusiveIso,
      p_excluded_domains: EXCLUDED_ANALYTICS_EMAIL_DOMAINS,
      p_excluded_emails: EXCLUDED_ANALYTICS_EMAILS,
      p_excluded_email_prefixes: EXCLUDED_ANALYTICS_EMAIL_PREFIXES,
      p_excluded_name_prefixes: EXCLUDED_ANALYTICS_NAME_PREFIXES,
      p_excluded_id_fragments: EXCLUDED_ANALYTICS_ID_FRAGMENTS,
      p_bypass_coupon_codes: BYPASS_COUPON_CODES,
    });
    if (error) throw error;

    const durationMs = Date.now() - startedAt;
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'Analytics executive summary completed',
        route: '/api/analytics/executive',
        duration_ms: durationMs,
        from: toDateOnly(normalizedFromDate),
        to: toDateOnly(normalizedToDate),
      }),
    );

    return NextResponse.json(
      {
        generated_at: new Date().toISOString(),
        window: {
          from: toDateOnly(normalizedFromDate),
          to: toDateOnly(normalizedToDate),
          from_iso: fromIso,
          to_exclusive_iso: toExclusiveIso,
        },
        ...(data as Record<string, unknown>),
        notes: [
          'All metrics exclude internal domains, test automation, invalid identities, and BYPASS payments.',
          'Today uses the Asia/Kolkata calendar day; selected-window metrics follow the date control.',
          'OpenRouter cost and routing are sourced from recorded generation telemetry.',
        ],
        performance: { duration_ms: durationMs, strategy: 'database_aggregate' },
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=45, stale-while-revalidate=120',
          'Server-Timing': `analytics-executive;dur=${durationMs}`,
        },
      },
    );
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Analytics executive summary failed',
        route: '/api/analytics/executive',
        duration_ms: durationMs,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.json(
      {
        error: 'Failed to compute the executive summary',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
