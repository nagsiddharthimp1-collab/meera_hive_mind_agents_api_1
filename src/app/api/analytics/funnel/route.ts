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

type FunnelSummaryRow = {
  signups: number | string | null;
  payment_page_opened: number | string | null;
  paid: number | string | null;
  active: number | string | null;
};

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDateParam(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function toDayStartIsoUtc(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function addDaysUtc(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function conversion(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function count(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const auth = await requireAnalyticsPermission(request, 'analytics.view');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message ?? 'Unauthorized' }, { status: auth.status });
  }

  const now = new Date();
  const searchParams = request.nextUrl.searchParams;
  const fromDate = parseDateParam(searchParams.get('from'), addDaysUtc(now, -30));
  const toDate = parseDateParam(searchParams.get('to'), now);
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
    const { data, error } = await auth.supabase.rpc('analytics_funnel_summary', {
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

    const row = ((data ?? [])[0] ?? {}) as FunnelSummaryRow;
    const signups = count(row.signups);
    const paymentPageOpened = count(row.payment_page_opened);
    const paid = count(row.paid);
    const active = count(row.active);
    const durationMs = Date.now() - startedAt;

    console.log(
      JSON.stringify({
        level: 'info',
        message: 'Analytics funnel completed',
        route: '/api/analytics/funnel',
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
        summary: {
          signups,
          payment_page_opened: paymentPageOpened,
          paid,
          active,
          conv_signup_to_payment_opened: conversion(paymentPageOpened, signups),
          conv_payment_opened_to_paid: conversion(paid, paymentPageOpened),
          conv_paid_to_active: conversion(active, paid),
          conv_signup_to_active: conversion(active, signups),
        },
        notes: [
          'payment_page_opened uses first-party paywall events captured from the payment route.',
          'active is WAU: unique real users with at least one user message in the selected window.',
          'Only users with a valid external email are included; internal, test, automation, incomplete, and BYPASS records are excluded.',
        ],
        performance: {
          duration_ms: durationMs,
          strategy: 'database_aggregate',
        },
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
          'Server-Timing': `analytics;dur=${durationMs}`,
        },
      },
    );
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Analytics funnel failed',
        route: '/api/analytics/funnel',
        duration_ms: durationMs,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.json(
      {
        error: 'Failed to compute analytics funnel',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
