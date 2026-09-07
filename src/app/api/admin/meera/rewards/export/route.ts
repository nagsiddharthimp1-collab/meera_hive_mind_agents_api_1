import { ACTIVE_MEERA_REWARD_EPOCH, calculateMeeraEarned, getRewardStatus, parseIntegerString } from '@/lib/meeraRewards';
import { csvEscape, isAllowedAdminEmail, requireAuthenticatedUser } from '@/lib/meeraServer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type ExportRow = {
  user_id: string;
  email: string | null;
  wallet_address: string | null;
  ai_tokens_consumed: number;
  meera_earned: number;
  status: string;
};

type LedgerExportRow = {
  user_id: string;
  ai_tokens_consumed: string | number | null;
  meera_earned: string | number | null;
  status: string | null;
  wallet_address: string | null;
};

type TokenUsageRow = {
  user_id: string | null;
  total_tokens: string | number | null;
};

type WalletLinkRow = {
  user_id: string;
  wallet_address: string | null;
};

type PublicUserRow = {
  id?: string | null;
  auth_id?: string | null;
  email?: string | null;
};

function parseDateOnly(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeExportStatus(status: string): string {
  return status.trim().toLowerCase().replace(/\s+/g, '_');
}

async function fetchEmailMap(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const emailMap = new Map<string, string>();
  if (userIds.length === 0) return emailMap;

  for (let index = 0; index < userIds.length; index += 500) {
    const chunk = userIds.slice(index, index + 500);
    const [{ data: byAuthId }, { data: byId }] = await Promise.all([
      supabase.from('users').select('id, auth_id, email').in('auth_id', chunk),
      supabase.from('users').select('id, auth_id, email').in('id', chunk),
    ]);

    for (const row of [...((byAuthId ?? []) as PublicUserRow[]), ...((byId ?? []) as PublicUserRow[])]) {
      const email = typeof row.email === 'string' ? row.email : '';
      if (!email) continue;
      if (row.auth_id) emailMap.set(row.auth_id, email);
      if (row.id) emailMap.set(row.id, email);
    }
  }

  return emailMap;
}

async function fetchWalletMap(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const walletMap = new Map<string, string>();
  if (userIds.length === 0) return walletMap;

  for (let index = 0; index < userIds.length; index += 500) {
    const chunk = userIds.slice(index, index + 500);
    const { data } = await supabase.from('wallet_links').select('user_id, wallet_address').in('user_id', chunk);
    for (const row of (data ?? []) as WalletLinkRow[]) {
      if (row.user_id && row.wallet_address) walletMap.set(row.user_id, row.wallet_address);
    }
  }

  return walletMap;
}

async function fetchLedgerRows(
  supabase: SupabaseClient,
  periodStart: string,
  periodEnd: string,
): Promise<LedgerExportRow[]> {
  const { data, error } = await supabase
    .from('meera_rewards_ledger')
    .select('user_id, ai_tokens_consumed, meera_earned, status, wallet_address')
    .gte('period_start', periodStart)
    .lte('period_end', periodEnd)
    .order('user_id', { ascending: true });

  if (error) {
    console.warn('[MEERA_ADMIN_EXPORT] Reward ledger export query failed; falling back to usage aggregation.', {
      message: error.message,
    });
    return [];
  }

  return (data ?? []) as LedgerExportRow[];
}

async function aggregateUsageRows(
  supabase: SupabaseClient,
  periodStart: string,
  periodEndExclusive: string,
): Promise<Map<string, number>> {
  const usageMap = new Map<string, number>();
  const pageSize = 1000;
  let offset = 0;

  while (offset < 10000) {
    const { data, error } = await supabase
      .from('token_usage_events')
      .select('user_id, total_tokens')
      .eq('ok', true)
      .gte('created_at', `${periodStart}T00:00:00.000Z`)
      .lt('created_at', `${periodEndExclusive}T00:00:00.000Z`)
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.warn('[MEERA_ADMIN_EXPORT] Token usage aggregation failed.', {
        message: error.message,
      });
      return usageMap;
    }

    const rows = (data ?? []) as TokenUsageRow[];
    for (const row of rows) {
      if (!row.user_id) continue;
      usageMap.set(row.user_id, (usageMap.get(row.user_id) ?? 0) + parseIntegerString(row.total_tokens));
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return usageMap;
}

function rowsToCsv(rows: ExportRow[]): string {
  const header = ['user_id', 'email', 'wallet_address', 'ai_tokens_consumed', 'meera_earned', 'status'];
  const lines = [
    header.join(','),
    ...rows.map((row) =>
      [
        row.user_id,
        row.email ?? '',
        row.wallet_address ?? '',
        row.ai_tokens_consumed,
        row.meera_earned,
        row.status,
      ]
        .map(csvEscape)
        .join(','),
    ),
  ];
  return `${lines.join('\n')}\n`;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!isAllowedAdminEmail(auth.user.email)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const periodStart = parseDateOnly(searchParams.get('periodStart'));
  const periodEnd = parseDateOnly(searchParams.get('periodEnd'));

  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: 'periodStart and periodEnd must be YYYY-MM-DD.' }, { status: 400 });
  }

  const weeklyCap = ACTIVE_MEERA_REWARD_EPOCH.weeklyEmissionCap;
  const periodEndExclusive = addDays(periodEnd, 1);
  const ledgerRows = await fetchLedgerRows(auth.supabase, periodStart, periodEnd);

  let rows: ExportRow[];
  if (ledgerRows.length > 0) {
    const userIds = Array.from(new Set(ledgerRows.map((row) => row.user_id).filter(Boolean)));
    const emailMap = await fetchEmailMap(auth.supabase, userIds);
    rows = ledgerRows.map((row) => ({
      user_id: row.user_id,
      email: emailMap.get(row.user_id) ?? null,
      wallet_address: row.wallet_address ?? null,
      ai_tokens_consumed: parseIntegerString(row.ai_tokens_consumed),
      meera_earned: Number(row.meera_earned ?? 0),
      status: normalizeExportStatus(row.status ?? 'pending'),
    }));
  } else {
    const usageMap = await aggregateUsageRows(auth.supabase, periodStart, periodEndExclusive);
    const userIds = Array.from(usageMap.keys());
    const [emailMap, walletMap] = await Promise.all([
      fetchEmailMap(auth.supabase, userIds),
      fetchWalletMap(auth.supabase, userIds),
    ]);

    rows = userIds.map((userId) => {
      const aiTokens = usageMap.get(userId) ?? 0;
      const uncappedMeera = calculateMeeraEarned(aiTokens);
      const meeraEarned = Number.isFinite(weeklyCap) && weeklyCap > 0 ? Math.min(uncappedMeera, weeklyCap) : uncappedMeera;
      const walletAddress = walletMap.get(userId) ?? null;
      const status = getRewardStatus({
        walletConnected: !!walletAddress,
        meeraEarnedLifetime: meeraEarned,
        meeraDistributed: 0,
        meeraPending: meeraEarned,
      });

      return {
        user_id: userId,
        email: emailMap.get(userId) ?? null,
        wallet_address: walletAddress,
        ai_tokens_consumed: aiTokens,
        meera_earned: meeraEarned,
        status: normalizeExportStatus(status),
      };
    });
  }

  rows.sort((left, right) => right.meera_earned - left.meera_earned);

  return new NextResponse(rowsToCsv(rows), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="meera-rewards-${periodStart}-to-${periodEnd}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
