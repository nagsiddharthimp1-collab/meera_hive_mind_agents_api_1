import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAnalyticsPermission } from '@/lib/analyticsAccess';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_ALLOWED_DOMAIN = (process.env.ANALYTICS_ALLOWED_EMAIL_DOMAIN ?? 'himeera.com')
  .trim()
  .toLowerCase();
const EXCLUDED_ANALYTICS_EMAIL_DOMAINS = new Set(
  (process.env.ANALYTICS_EXCLUDED_EMAIL_DOMAINS ?? `example.com,example.net,example.org,${DEFAULT_ALLOWED_DOMAIN}`)
    .split(',')
    .map((value) => value.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean),
);
const EXCLUDED_ANALYTICS_EMAIL_PREFIXES = (
  process.env.ANALYTICS_EXCLUDED_EMAIL_PREFIXES ?? 'codex-,test-,smoke-,e2e-,qa-'
)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const EXCLUDED_ANALYTICS_NAME_PREFIXES = (
  process.env.ANALYTICS_EXCLUDED_NAME_PREFIXES ?? 'codex,memory keyword smoke'
)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const EXCLUDED_ANALYTICS_ID_FRAGMENTS = (
  process.env.ANALYTICS_EXCLUDED_ID_FRAGMENTS ?? 'bypass,smoke,codex,test,e2e'
)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const BYPASS_COUPON_CODES = new Set(
  (process.env.ANALYTICS_BYPASS_COUPON_CODES ?? process.env.PAYMENT_BYPASS_CODES ?? 'BYPASS')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean),
);

const BATCH_SIZE = 1000;
const USER_FETCH_CHUNK = 500;
const MAX_PAYMENT_LOOKBACK_DAYS = 400;
const MAX_USERS_RETURN = 5000;

const PAYMENT_GRANT_STATUSES = new Set(['paid', 'active', 'success']);

type StageKey = 'signups' | 'payment_page_opened' | 'paid' | 'active';

const STAGE_LABELS: Record<StageKey, string> = {
  signups: 'Signups',
  payment_page_opened: 'Payment Opened',
  paid: 'Paid',
  active: 'WAU',
};

type PaymentRow = {
  payment_id: string | null;
  user_id: string | null;
  payment_status: string | null;
  plan_type: string | null;
  payment_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  amount: number | string | null;
  order_id: string | null;
  coupon_code: string | null;
  payment_method: string | null;
};

type UserRecord = Record<string, unknown> & { id?: string | null };

type SignupUserRow = {
  id?: string | null;
  auth_id?: string | null;
  email?: string | null;
  name?: string | null;
  deleted?: boolean | null;
};

type ActivityMessageRow = {
  user_id: string | null;
  timestamp: string | null;
};

type PaymentSnapshot = {
  latestStatus: string | null;
  latestPlanType: 'monthly' | 'lifetime' | null;
  latestAmount: number | null;
  latestPaymentAt: string | null;
  openedInWindow: boolean;
  paidInWindow: boolean;
};

type ActiveSnapshot = {
  messageCount: number;
  lastActiveAt: string | null;
};

function normalizeStatus(status: unknown): string {
  return String(status ?? '').trim().toLowerCase();
}

function normalizeCouponCode(couponCode: unknown): string {
  return String(couponCode ?? '').trim().toUpperCase();
}

function normalizePlanType(planType: unknown): 'monthly' | 'lifetime' | null {
  const normalized = String(planType ?? '').trim().toLowerCase();
  if (normalized === 'monthly' || normalized === 'lifetime') return normalized;
  return null;
}

function normalizeAmount(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function inferPlanType(row: PaymentRow): 'monthly' | 'lifetime' | null {
  const normalizedPlan = normalizePlanType(row.plan_type);
  if (normalizedPlan) return normalizedPlan;

  const amount = normalizeAmount(row.amount);
  if (amount === 499) return 'lifetime';
  if (amount === 1 || amount === 219) return 'monthly';
  return null;
}

function resolvePaymentTimestamp(row: PaymentRow): number | null {
  const candidates = [row.payment_date, row.created_at, row.updated_at];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const ts = Date.parse(candidate);
    if (!Number.isNaN(ts)) return ts;
  }
  return null;
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDateParam(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
}

function toDayStartIsoUtc(date: Date): string {
  const normalized = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return normalized.toISOString();
}

function addDaysUtc(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function conversion(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasExcludedSyntheticId(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized || isUuidLike(normalized)) return false;
  return EXCLUDED_ANALYTICS_ID_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function isRealAnalyticsUser(row: SignupUserRow): boolean {
  if (row.deleted === true) return false;

  if (hasExcludedSyntheticId(row.id)) return false;

  const email = String(row.email ?? '').trim().toLowerCase();
  const name = String(row.name ?? '').trim().toLowerCase();

  if (email) {
    const [localPart, domain] = email.split('@');
    if (domain && EXCLUDED_ANALYTICS_EMAIL_DOMAINS.has(domain)) return false;
    if (EXCLUDED_ANALYTICS_EMAIL_PREFIXES.some((prefix) => localPart.startsWith(prefix))) return false;
    if (email.includes('+codex') || email.includes('+smoke') || email.includes('+test')) return false;
  }

  if (name && EXCLUDED_ANALYTICS_NAME_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;

  return true;
}

function isBypassPayment(payment: PaymentRow): boolean {
  const couponCode = normalizeCouponCode(payment.coupon_code);
  if (couponCode && BYPASS_COUPON_CODES.has(couponCode)) return true;

  return [payment.user_id, payment.payment_id, payment.order_id].some((value) =>
    String(value ?? '').trim().toLowerCase().includes('bypass'),
  );
}

function hasPositivePaymentAmount(payment: PaymentRow): boolean {
  return normalizeAmount(payment.amount) !== null;
}

function isRealPaymentRecord(payment: PaymentRow): boolean {
  return !isBypassPayment(payment) && hasPositivePaymentAmount(payment);
}

function isRealPaymentGrant(payment: PaymentRow): boolean {
  return PAYMENT_GRANT_STATUSES.has(normalizeStatus(payment.payment_status)) && isRealPaymentRecord(payment);
}

async function fetchSignupUserIds(
  supabase: SupabaseClient,
  fromIso: string,
  toExclusiveIso: string,
): Promise<Set<string>> {
  const userIds = new Set<string>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('users')
      .select('id, auth_id, email, name, deleted, created_at')
      .gte('created_at', fromIso)
      .lt('created_at', toExclusiveIso)
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) throw new Error(`Failed loading signups: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data as SignupUserRow[]) {
      if (!isRealAnalyticsUser(row)) continue;
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      if (id) userIds.add(id);
    }

    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return userIds;
}

async function fetchWeeklyActiveUserSnapshotMap(
  supabase: SupabaseClient,
  fromIso: string,
  toExclusiveIso: string,
): Promise<Map<string, ActiveSnapshot>> {
  const latestByAuthId = new Map<string, number>();
  const messageCountByAuthId = new Map<string, number>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('messages')
      .select('user_id, timestamp')
      .eq('content_type', 'user')
      .gte('timestamp', fromIso)
      .lt('timestamp', toExclusiveIso)
      .order('timestamp', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) throw new Error(`Failed loading WAU messages: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data as ActivityMessageRow[]) {
      const authId = typeof row.user_id === 'string' ? row.user_id.trim() : '';
      const timestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN;
      if (!authId || Number.isNaN(timestamp)) continue;

      messageCountByAuthId.set(authId, (messageCountByAuthId.get(authId) ?? 0) + 1);

      const existing = latestByAuthId.get(authId);
      if (existing === undefined || timestamp > existing) {
        latestByAuthId.set(authId, timestamp);
      }
    }

    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  const activeMap = new Map<string, ActiveSnapshot>();
  const authIds = Array.from(latestByAuthId.keys());

  for (const chunk of chunkArray(authIds, USER_FETCH_CHUNK)) {
    const { data, error } = await supabase
      .from('users')
      .select('id, auth_id, email, name, deleted, created_at')
      .in('auth_id', chunk);

    if (error) throw new Error(`Failed loading active users: ${error.message}`);

    for (const row of (data ?? []) as SignupUserRow[]) {
      if (!isRealAnalyticsUser(row)) continue;
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      const authId = typeof row.auth_id === 'string' ? row.auth_id.trim() : '';
      const latest = authId ? latestByAuthId.get(authId) : undefined;
      if (!id || latest === undefined) continue;

      activeMap.set(id, {
        messageCount: authId ? messageCountByAuthId.get(authId) ?? 0 : 0,
        lastActiveAt: new Date(latest).toISOString(),
      });
    }
  }

  return activeMap;
}

async function fetchPaymentsByCreatedAtWindow(
  supabase: SupabaseClient,
  fromIso: string,
  toExclusiveIso: string,
): Promise<PaymentRow[]> {
  const rows: PaymentRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('payments')
      .select('payment_id, user_id, payment_status, plan_type, payment_date, created_at, updated_at, amount, order_id, coupon_code, payment_method')
      .gte('created_at', fromIso)
      .lt('created_at', toExclusiveIso)
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) throw new Error(`Failed loading payments in window: ${error.message}`);
    if (!data || data.length === 0) break;

    rows.push(...(data as PaymentRow[]));

    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return rows;
}

async function fetchPaymentOpenedUserIds(
  supabase: SupabaseClient,
  fromIso: string,
  toExclusiveIso: string,
): Promise<Set<string>> {
  const authIds = new Set<string>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('analytics_events')
      .select('user_id, created_at')
      .eq('event_name', 'payment_page_opened')
      .gte('created_at', fromIso)
      .lt('created_at', toExclusiveIso)
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) throw new Error(`Failed loading payment-opened events: ${error.message}`);
    if (!data?.length) break;
    for (const row of data) {
      const authId = String(row.user_id ?? '').trim();
      if (authId) authIds.add(authId);
    }
    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  const userIds = new Set<string>();
  for (const chunk of chunkArray(Array.from(authIds), USER_FETCH_CHUNK)) {
    const { data, error } = await supabase
      .from('users')
      .select('id, auth_id, email, name, deleted')
      .in('auth_id', chunk);
    if (error) throw new Error(`Failed resolving payment-opened users: ${error.message}`);
    for (const row of (data ?? []) as SignupUserRow[]) {
      if (!isRealAnalyticsUser(row)) continue;
      const id = String(row.id ?? '').trim();
      if (id) userIds.add(id);
    }
  }
  return userIds;
}

async function fetchPaymentsForSnapshot(
  supabase: SupabaseClient,
  toExclusiveIso: string,
): Promise<PaymentRow[]> {
  const rows: PaymentRow[] = [];
  const toExclusiveDate = new Date(toExclusiveIso);
  const lookbackStart = addDaysUtc(toExclusiveDate, -MAX_PAYMENT_LOOKBACK_DAYS).toISOString();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('payments')
      .select('payment_id, user_id, payment_status, plan_type, payment_date, created_at, updated_at, amount, order_id, coupon_code, payment_method')
      .gte('created_at', lookbackStart)
      .lt('created_at', toExclusiveIso)
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) throw new Error(`Failed loading payments for snapshot: ${error.message}`);
    if (!data || data.length === 0) break;

    rows.push(...(data as PaymentRow[]));

    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return rows;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function fetchUsersByIds(supabase: SupabaseClient, ids: string[]): Promise<Map<string, UserRecord>> {
  const out = new Map<string, UserRecord>();
  const chunks = chunkArray(ids, USER_FETCH_CHUNK);

  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from('users')
      .select('id, auth_id, email, name, created_at')
      .in('id', chunk);
    if (error) throw new Error(`Failed loading users for drilldown: ${error.message}`);

    for (const row of (data ?? []) as UserRecord[]) {
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      if (!id) continue;
      out.set(id, row);
    }
  }

  return out;
}

function pickString(record: UserRecord | undefined, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function buildPaymentSnapshotMap(
  payments: PaymentRow[],
  fromMs: number,
  toExclusiveMs: number,
): Map<string, PaymentSnapshot> {
  const map = new Map<string, PaymentSnapshot>();

  for (const payment of payments) {
    const userId = typeof payment.user_id === 'string' ? payment.user_id.trim() : '';
    if (!userId) continue;

    if (isBypassPayment(payment)) continue;

    const ts = resolvePaymentTimestamp(payment);
    const status = normalizeStatus(payment.payment_status);
    if (PAYMENT_GRANT_STATUSES.has(status) && !hasPositivePaymentAmount(payment)) continue;

    const plan = inferPlanType(payment);
    const amount = normalizeAmount(payment.amount);

    const existing = map.get(userId) ?? {
      latestStatus: null,
      latestPlanType: null,
      latestAmount: null,
      latestPaymentAt: null,
      openedInWindow: false,
      paidInWindow: false,
    };

    if (ts !== null) {
      if (ts >= fromMs && ts < toExclusiveMs) {
        if (isRealPaymentRecord(payment)) {
          existing.openedInWindow = true;
        }
        if (isRealPaymentGrant(payment)) {
          existing.paidInWindow = true;
        }
      }

      const existingLatestTs = existing.latestPaymentAt ? Date.parse(existing.latestPaymentAt) : Number.NaN;
      if (Number.isNaN(existingLatestTs) || ts > existingLatestTs) {
        existing.latestStatus = status || null;
        existing.latestPlanType = plan;
        existing.latestAmount = amount;
        existing.latestPaymentAt = new Date(ts).toISOString();
      }
    }

    map.set(userId, existing);
  }

  return map;
}

function isKnownStage(value: string): value is StageKey {
  return value === 'signups' || value === 'payment_page_opened' || value === 'paid' || value === 'active';
}

export async function GET(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server analytics env is missing' }, { status: 500 });
  }

  const auth = await requireAnalyticsPermission(request, 'users.list');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message ?? 'Unauthorized' }, { status: auth.status });
  }

  const stageParam = String(request.nextUrl.searchParams.get('stage') ?? '').trim();
  if (!isKnownStage(stageParam)) {
    return NextResponse.json({ error: 'Invalid stage. Use signups|payment_page_opened|paid|active' }, { status: 400 });
  }

  const now = new Date();
  const defaultFrom = addDaysUtc(now, -30);
  const searchParams = request.nextUrl.searchParams;
  const fromDate = parseDateParam(searchParams.get('from'), defaultFrom);
  const toDate = parseDateParam(searchParams.get('to'), now);

  const normalizedFromDate = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
  const normalizedToDate = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate()));

  if (normalizedToDate < normalizedFromDate) {
    return NextResponse.json({ error: '`to` must be on or after `from`' }, { status: 400 });
  }

  const fromIso = toDayStartIsoUtc(normalizedFromDate);
  const toExclusiveIso = toDayStartIsoUtc(addDaysUtc(normalizedToDate, 1));
  const fromMs = Date.parse(fromIso);
  const toExclusiveMs = Date.parse(toExclusiveIso);

  const supabase = auth.supabase;

  try {
    const [signupUserIds, paymentOpenedEventUsers, paymentsInWindow, paymentsForSnapshot, activeSnapshotMap] = await Promise.all([
      fetchSignupUserIds(supabase, fromIso, toExclusiveIso),
      fetchPaymentOpenedUserIds(supabase, fromIso, toExclusiveIso),
      fetchPaymentsByCreatedAtWindow(supabase, fromIso, toExclusiveIso),
      fetchPaymentsForSnapshot(supabase, toExclusiveIso),
      fetchWeeklyActiveUserSnapshotMap(supabase, fromIso, toExclusiveIso),
    ]);

    const paymentPageOpenedUsers = new Set(Array.from(paymentOpenedEventUsers).filter((id) => signupUserIds.has(id)));
    const paidUsers = new Set<string>();

    for (const payment of paymentsInWindow) {
      const userId = typeof payment.user_id === 'string' ? payment.user_id.trim() : '';
      if (!userId || !signupUserIds.has(userId)) continue;

      if (isRealPaymentGrant(payment)) {
        paidUsers.add(userId);
      }
    }

    const activeUsersInWindow = new Set(activeSnapshotMap.keys());

    const signups = signupUserIds.size;
    const paymentPageOpened = paymentPageOpenedUsers.size;
    const paid = paidUsers.size;
    const active = activeUsersInWindow.size;

    const stageSets: Record<StageKey, Set<string>> = {
      signups: signupUserIds,
      payment_page_opened: paymentPageOpenedUsers,
      paid: paidUsers,
      active: activeUsersInWindow,
    };

    const selectedStageUsersSet = stageSets[stageParam];
    const selectedUserIds = Array.from(selectedStageUsersSet);

    const paymentSnapshotMap = buildPaymentSnapshotMap(paymentsForSnapshot, fromMs, toExclusiveMs);
    const userMap = await fetchUsersByIds(supabase, selectedUserIds);

    const detailRows = selectedUserIds.map((userId) => {
      const user = userMap.get(userId);
      const paymentSnapshot = paymentSnapshotMap.get(userId);

      const sourceChannel =
        pickString(user, ['acquisition_channel', 'source_channel', 'signup_source', 'source', 'utm_source']) ??
        'unknown';

      return {
        user_id: userId,
        email: pickString(user, ['email', 'user_email']),
        name: pickString(user, ['name', 'full_name']),
        signup_at: pickString(user, ['created_at', 'signup_at']),
        source_channel: sourceChannel,
        campaign: pickString(user, ['campaign_id', 'campaign', 'utm_campaign']),
        country: pickString(user, ['country_code', 'country']),
        payment_opened: paymentPageOpenedUsers.has(userId),
        paid: paidUsers.has(userId),
        active: activeUsersInWindow.has(userId),
        payment_status: paymentSnapshot?.latestStatus ?? null,
        plan_type: paymentSnapshot?.latestPlanType ?? null,
        amount: paymentSnapshot?.latestAmount ?? null,
        last_payment_at: paymentSnapshot?.latestPaymentAt ?? null,
        message_count: activeSnapshotMap.get(userId)?.messageCount ?? 0,
        last_active_at: activeSnapshotMap.get(userId)?.lastActiveAt ?? null,
      };
    });

    detailRows.sort((a, b) => {
      if (stageParam === 'active') {
        const at = a.last_active_at ? Date.parse(a.last_active_at) : Number.NaN;
        const bt = b.last_active_at ? Date.parse(b.last_active_at) : Number.NaN;
        if (!Number.isNaN(at) || !Number.isNaN(bt)) {
          if (Number.isNaN(at)) return 1;
          if (Number.isNaN(bt)) return -1;
          return bt - at;
        }
      }

      const at = a.signup_at ? Date.parse(a.signup_at) : Number.NaN;
      const bt = b.signup_at ? Date.parse(b.signup_at) : Number.NaN;
      if (Number.isNaN(at) && Number.isNaN(bt)) return a.user_id.localeCompare(b.user_id);
      if (Number.isNaN(at)) return 1;
      if (Number.isNaN(bt)) return -1;
      return bt - at;
    });

    const truncated = detailRows.length > MAX_USERS_RETURN;
    const users = truncated ? detailRows.slice(0, MAX_USERS_RETURN) : detailRows;

    const sourceBreakdownMap = new Map<string, number>();
    for (const row of users) {
      sourceBreakdownMap.set(row.source_channel, (sourceBreakdownMap.get(row.source_channel) ?? 0) + 1);
    }

    const source_breakdown = Array.from(sourceBreakdownMap.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

    return NextResponse.json(
      {
        generated_at: new Date().toISOString(),
        window: {
          from: toDateOnly(normalizedFromDate),
          to: toDateOnly(normalizedToDate),
          from_iso: fromIso,
          to_exclusive_iso: toExclusiveIso,
        },
        stage: {
          key: stageParam,
          label: STAGE_LABELS[stageParam],
          user_count: selectedUserIds.length,
          users_returned: users.length,
          truncated,
          truncate_limit: MAX_USERS_RETURN,
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
        source_breakdown,
        users,
        notes: [
          'payment_page_opened uses first-party paywall events captured from the payment route.',
          'active is WAU: unique real users with at least one user message in the selected window.',
          'Test/internal automation users are excluded from user counts; BYPASS payment rows do not count as opened or paid.',
        ],
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    console.error('Analytics funnel users API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to compute stage user details',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
