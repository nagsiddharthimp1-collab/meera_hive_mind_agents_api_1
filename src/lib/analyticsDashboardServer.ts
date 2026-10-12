import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { aggregateDashboard, DAY, timestamp, type DashboardInput } from './analyticsDashboardMetrics';

const list = (key: string, fallback: string) =>
  (process.env[key] ?? fallback)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
function exclusions() {
  const domain = process.env.ANALYTICS_ALLOWED_EMAIL_DOMAIN ?? 'himeera.com';
  return {
    domains: list(
      'ANALYTICS_EXCLUDED_EMAIL_DOMAINS',
      `example.com,example.net,example.org,example.invalid,invalid,local,localhost,${domain}`,
    ).map((s) => s.replace(/^@/, '')),
    emails: list('ANALYTICS_EXCLUDED_EMAILS', ''),
    email_prefixes: list('ANALYTICS_EXCLUDED_EMAIL_PREFIXES', 'codex-,test-,smoke-,e2e-,qa-'),
    name_prefixes: list('ANALYTICS_EXCLUDED_NAME_PREFIXES', 'codex,memory keyword smoke'),
    id_fragments: list('ANALYTICS_EXCLUDED_ID_FRAGMENTS', 'bypass,smoke,codex,test,e2e'),
    bypass_codes: list('ANALYTICS_BYPASS_COUPON_CODES', process.env.PAYMENT_BYPASS_CODES ?? 'BYPASS'),
  };
}
export function validateWindow(from: string | null, to: string | null) {
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    throw new Error('Choose valid start and end dates.');
  const start = timestamp(from),
    end = timestamp(to) + DAY;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    new Date(start).toISOString().slice(0, 10) !== from ||
    new Date(end - DAY).toISOString().slice(0, 10) !== to ||
    start >= end ||
    end - start > 3660 * DAY ||
    to > new Date().toISOString().slice(0, 10)
  )
    throw new Error('Choose an ordered date range ending today or earlier (maximum 10 years).');
  return { from, to, start, end };
}
async function source(s: SupabaseClient, from: string, to: string, section: 'product' | 'ai') {
  const w = validateWindow(from, to);
  const { data, error } = await s
    .rpc('analytics_dashboard_source_v1', {
      p_from: new Date(w.start).toISOString(),
      p_to: new Date(w.end).toISOString(),
      p_section: section,
      p_exclusions: exclusions(),
    })
    .abortSignal(AbortSignal.timeout(45_000));
  if (error || !data) {
    console.error('[analytics-dashboard-source]', section, error?.code, error?.message);
    throw new Error('Analytics source unavailable.');
  }
  return data;
}
// Bounded, server-only cache. Every API request still authenticates and checks RBAC.
const snapshots = new Map<string, { expires: number; promise: Promise<ReturnType<typeof aggregateDashboard>> }>();
export function loadDashboard(s: SupabaseClient, from: string, to: string) {
  const key = `${from}:${to}:${JSON.stringify(exclusions())}`;
  const hit = snapshots.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const promise = source(s, from, to, 'product').then((data) => aggregateDashboard(data as DashboardInput, from, to));
  if (snapshots.size >= 8) snapshots.delete(snapshots.keys().next().value!);
  snapshots.set(key, { expires: Date.now() + 60_000, promise });
  void promise.catch(() => snapshots.delete(key));
  return promise;
}
export type AiStats = {
  requests: number;
  tokens: number;
  cost: number | null;
  costCoverage: number | null;
  success: number | null;
  p50: number | null;
  p95: number | null;
  latencyCoverage: number | null;
};
const emptyStats: AiStats = {
  requests: 0,
  tokens: 0,
  cost: null,
  costCoverage: null,
  success: null,
  p50: null,
  p95: null,
  latencyCoverage: null,
};
export async function loadAi(s: SupabaseClient, from: string, to: string) {
  const w = validateWindow(from, to);
  const data = (await source(s, from, to, 'ai')) as {
    groups: (AiStats & {
      period: string;
      bucket_date: string | null;
      model: string | null;
      gday: number;
      gmodel: number;
    })[];
    recent: {
      id: string;
      date: string;
      model: string;
      tokens: number;
      ok: boolean;
      cost: number | null;
      latency: number | null;
    }[];
  };
  const current = data.groups.find((g) => g.period === 'current' && g.gday === 1 && g.gmodel === 1) ?? {
    ...emptyStats,
  };
  const previous = data.groups.find((g) => g.period === 'previous' && g.gday === 1 && g.gmodel === 1) ?? {
    ...emptyStats,
  };
  const bucketDays = w.end - w.start > 100 * DAY ? 7 : 1;
  const buckets = new Map(
    data.groups.filter((g) => g.period === 'current' && g.gday === 0).map((g) => [g.bucket_date, g]),
  );
  const daily = [];
  for (let t = w.start; t < w.end; t += bucketDays * DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    daily.push({ ...emptyStats, ...buckets.get(date), date });
  }
  const models = data.groups
    .filter((g) => g.period === 'current' && g.gmodel === 0)
    .map((g) => ({ ...g, model: g.model || 'Unknown' }))
    .sort((a, b) => b.requests - a.requests);
  return { from, to, generatedAt: new Date().toISOString(), current, previous, daily, models, recent: data.recent };
}
export type AiData = Awaited<ReturnType<typeof loadAi>>;
