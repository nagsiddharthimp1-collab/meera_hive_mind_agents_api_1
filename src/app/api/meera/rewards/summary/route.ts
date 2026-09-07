import { getMeeraPrice } from '@/lib/meeraPrice';
import {
  ACTIVE_MEERA_REWARD_EPOCH,
  MEERA_TOKEN,
  calculateEstimatedValueUsdc,
  calculateMeeraEarned,
  formatMeeraUnitsFromWei,
  formatInteger,
  getRewardStatus,
  parseIntegerString,
} from '@/lib/meeraRewards';
import { requireAuthenticatedUser } from '@/lib/meeraServer';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type RewardLedgerRow = {
  id?: string;
  period_start?: string | null;
  period_end?: string | null;
  ai_tokens_consumed?: string | number | null;
  meera_earned?: string | number | null;
  status?: string | null;
  wallet_address?: string | null;
  distribution_tx_hash?: string | null;
  distributed_at?: string | null;
  created_at?: string | null;
};

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLedgerStatus(status: unknown, fallback: string): string {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'wallet_required') return 'Wallet Required';
  return normalized
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getCurrentWeekBounds() {
  const now = new Date();
  const day = now.getUTCDay();
  const mondayDelta = day === 0 ? -6 : 1 - day;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() + mondayDelta);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  };
}

async function getMeeraWalletBalance(walletAddress: string | null): Promise<string | null> {
  if (!walletAddress) return null;
  const rpcUrl = process.env.POLYGON_RPC_URL;
  if (!rpcUrl) return null;

  const normalizedWallet = walletAddress.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(normalizedWallet)) return null;

  const data = `0x70a08231${normalizedWallet.padStart(64, '0')}`;

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          {
            to: MEERA_TOKEN.address,
            data,
          },
          'latest',
        ],
      }),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as { result?: string };
    if (!payload.result || !/^0x[0-9a-f]+$/i.test(payload.result)) return null;
    return formatMeeraUnitsFromWei(BigInt(payload.result));
  } catch (error) {
    console.warn('[MEERA_REWARDS] Failed to read MEERA wallet balance.', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { supabase, user } = auth;

  const [{ data: tokenLedger, error: tokenLedgerError }, { data: walletLink }, price] = await Promise.all([
    supabase.from('user_token_ledger').select('total_tokens').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('wallet_links')
      .select('wallet_address, chain_id, verified_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    getMeeraPrice(),
  ]);

  if (tokenLedgerError) {
    console.warn('[MEERA_REWARDS] Failed to load user token ledger.', {
      userId: user.id,
      message: tokenLedgerError.message,
    });
  }

  const aiTokensConsumedLifetime = parseIntegerString(
    (tokenLedger as { total_tokens?: string | number | null } | null)?.total_tokens,
  );
  const meeraEarnedLifetime = calculateMeeraEarned(aiTokensConsumedLifetime);

  const { data: rewardLedgerRows, error: rewardLedgerError } = await supabase
    .from('meera_rewards_ledger')
    .select(
      'id, period_start, period_end, ai_tokens_consumed, meera_earned, status, wallet_address, distribution_tx_hash, distributed_at, created_at',
    )
    .eq('user_id', user.id)
    .order('period_start', { ascending: false })
    .limit(12);

  if (rewardLedgerError) {
    console.warn('[MEERA_REWARDS] Failed to load reward ledger.', {
      userId: user.id,
      message: rewardLedgerError.message,
    });
  }

  const ledgerRows = (rewardLedgerRows ?? []) as RewardLedgerRow[];
  const meeraDistributed = ledgerRows
    .filter((row) => String(row.status ?? '').toLowerCase() === 'distributed')
    .reduce((sum, row) => sum + toNumber(row.meera_earned), 0);
  const meeraPending = Math.max(meeraEarnedLifetime - meeraDistributed, 0);

  const walletAddress =
    typeof (walletLink as { wallet_address?: unknown } | null)?.wallet_address === 'string'
      ? ((walletLink as { wallet_address: string }).wallet_address ?? null)
      : null;
  const walletConnected = !!walletAddress;

  const rewardStatus = getRewardStatus({
    walletConnected,
    meeraEarnedLifetime,
    meeraDistributed,
    meeraPending,
  });
  const estimatedValueUsdc = calculateEstimatedValueUsdc(meeraEarnedLifetime, price.priceUsdc);
  const meeraWalletBalance = await getMeeraWalletBalance(walletAddress);

  const rewardHistory =
    ledgerRows.length > 0
      ? ledgerRows.map((row) => ({
          id: row.id ?? `${row.period_start ?? ''}:${row.period_end ?? ''}`,
          periodStart: row.period_start ?? null,
          periodEnd: row.period_end ?? null,
          aiTokensConsumed: parseIntegerString(row.ai_tokens_consumed),
          aiTokensConsumedFormatted: formatInteger(row.ai_tokens_consumed),
          meeraEarned: toNumber(row.meera_earned),
          status: normalizeLedgerStatus(row.status, rewardStatus),
          walletAddress: row.wallet_address ?? null,
          distributionTxHash: row.distribution_tx_hash ?? null,
          distributedAt: row.distributed_at ?? null,
        }))
      : [
          {
            id: 'lifetime-derived',
            ...getCurrentWeekBounds(),
            aiTokensConsumed: aiTokensConsumedLifetime,
            aiTokensConsumedFormatted: formatInteger(aiTokensConsumedLifetime),
            meeraEarned: meeraEarnedLifetime,
            status: rewardStatus,
            walletAddress,
            distributionTxHash: null,
            distributedAt: null,
          },
        ];

  return NextResponse.json({
    aiTokensConsumedLifetime,
    aiTokensConsumedLifetimeFormatted: formatInteger(aiTokensConsumedLifetime),
    meeraEarnedLifetime,
    meeraDistributed,
    meeraPending,
    currentMeeraPriceUsdc: price.priceUsdc,
    estimatedValueUsdc,
    price,
    walletConnected,
    walletAddress,
    meeraWalletBalance,
    chainId: walletConnected ? ((walletLink as { chain_id?: number | null })?.chain_id ?? MEERA_TOKEN.chainId) : null,
    rewardStatus,
    activeRewardEpoch: ACTIVE_MEERA_REWARD_EPOCH.name,
    aiTokensPerMeera: ACTIVE_MEERA_REWARD_EPOCH.aiTokensPerMeera,
    weeklyEmissionCap: ACTIVE_MEERA_REWARD_EPOCH.weeklyEmissionCap,
    rewardHistory,
  });
}
