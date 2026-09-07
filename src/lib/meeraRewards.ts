export type MeeraRewardEpoch = {
  name: string;
  aiTokensPerMeera: number;
  weeklyEmissionCap: number;
};

export const MEERA_REWARD_EPOCHS = [
  {
    name: 'Genesis',
    aiTokensPerMeera: 1_000_000,
    weeklyEmissionCap: 50_000,
  },
  {
    name: 'Growth',
    aiTokensPerMeera: 2_000_000,
    weeklyEmissionCap: 25_000,
  },
  {
    name: 'Scale',
    aiTokensPerMeera: 4_000_000,
    weeklyEmissionCap: 12_500,
  },
  {
    name: 'Mature',
    aiTokensPerMeera: 8_000_000,
    weeklyEmissionCap: 6_250,
  },
] as const satisfies readonly MeeraRewardEpoch[];

export const ACTIVE_MEERA_REWARD_EPOCH =
  MEERA_REWARD_EPOCHS.find(
    (epoch) => epoch.name === (process.env.NEXT_PUBLIC_MEERA_ACTIVE_REWARD_EPOCH ?? 'Genesis'),
  ) ?? MEERA_REWARD_EPOCHS[0];

export const MEERA_TOKEN = {
  name: 'MEERA',
  symbol: process.env.NEXT_PUBLIC_MEERA_SYMBOL ?? 'MEERA',
  address:
    process.env.NEXT_PUBLIC_MEERA_TOKEN_ADDRESS ??
    '0xdeCd7dD35Cf8CB6A901871c2584B4d67718B5CB1',
  decimals: Number(process.env.NEXT_PUBLIC_MEERA_DECIMALS ?? 18),
  chainId: Number(process.env.NEXT_PUBLIC_MEERA_CHAIN_ID ?? 137),
  chainHexId: '0x89',
  networkName: 'Polygon Mainnet',
  logoUrl: process.env.NEXT_PUBLIC_MEERA_LOGO_URL ?? 'https://himeera.com/meera-logo.svg',
} as const;

export const POLYGON_USDC_ADDRESSES = new Set([
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
]);

export const POLYGON_USDT_ADDRESS = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f';

export type MeeraPriceSource = 'DEXSCREENER_LIVE' | 'FALLBACK' | 'UNAVAILABLE';

export type MeeraTokenSummary = {
  symbol: string;
  address: string;
};

export type MeeraPriceResponse = {
  priceUsdc: number | null;
  source: MeeraPriceSource;
  chainId?: string | null;
  dexId?: string | null;
  pairAddress?: string | null;
  baseToken?: MeeraTokenSummary | null;
  quoteToken?: MeeraTokenSummary | null;
  liquidityUsd?: number | null;
  updatedAt?: string | null;
};

export type RewardStatus = 'Wallet Required' | 'Pending' | 'Claimable' | 'Distributed';

export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function isSameAddress(left?: string | null, right?: string | null): boolean {
  return !!left && !!right && normalizeAddress(left) === normalizeAddress(right);
}

export function parseIntegerString(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === 'bigint') return Number(value > BigInt(0) ? value : BigInt(0));
  const normalized = String(value ?? '')
    .replace(/,/g, '')
    .trim();
  if (!/^\d+$/.test(normalized)) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateMeeraEarned(
  aiTokensConsumed: unknown,
  epoch: MeeraRewardEpoch = ACTIVE_MEERA_REWARD_EPOCH,
): number {
  return parseIntegerString(aiTokensConsumed) / epoch.aiTokensPerMeera;
}

export function calculateEstimatedValueUsdc(meeraEarned: number, priceUsdc: number | null): number | null {
  if (!Number.isFinite(meeraEarned) || meeraEarned <= 0) return 0;
  if (typeof priceUsdc !== 'number' || !Number.isFinite(priceUsdc) || priceUsdc <= 0) return null;
  return meeraEarned * priceUsdc;
}

export function getRewardStatus(args: {
  walletConnected: boolean;
  meeraEarnedLifetime: number;
  meeraDistributed: number;
  meeraPending: number;
}): RewardStatus {
  if (!args.walletConnected && args.meeraEarnedLifetime > 0) return 'Wallet Required';
  if (args.walletConnected && args.meeraPending >= 1) return 'Claimable';
  if (args.walletConnected && args.meeraPending < 1) return 'Pending';
  if (args.meeraDistributed > 0 && args.meeraPending === 0) return 'Distributed';
  return 'Pending';
}

export function formatInteger(value: unknown): string {
  return parseIntegerString(value).toLocaleString('en-US');
}

export function formatRewardRate(epoch: MeeraRewardEpoch = ACTIVE_MEERA_REWARD_EPOCH): string {
  return `${formatInteger(epoch.aiTokensPerMeera)} AI tokens = 1 ${MEERA_TOKEN.symbol}`;
}

export function formatMeera(value: number, maximumFractionDigits = 2): string {
  if (!Number.isFinite(value)) return `0.00 ${MEERA_TOKEN.symbol}`;
  const safeMaximumFractionDigits = Math.max(0, Math.trunc(maximumFractionDigits));
  const minimumFractionDigits = Math.min(2, safeMaximumFractionDigits);
  return `${value.toLocaleString('en-US', {
    minimumFractionDigits,
    maximumFractionDigits: safeMaximumFractionDigits,
  })} ${MEERA_TOKEN.symbol}`;
}

export function formatMeeraPlain(value: number, maximumFractionDigits = 2): string {
  if (!Number.isFinite(value)) return '0.00';
  const safeMaximumFractionDigits = Math.max(0, Math.trunc(maximumFractionDigits));
  const minimumFractionDigits = Math.min(2, safeMaximumFractionDigits);
  return value.toLocaleString('en-US', {
    minimumFractionDigits,
    maximumFractionDigits: safeMaximumFractionDigits,
  });
}

export function formatPriceUsd(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'Unavailable';
  const maximumFractionDigits = value < 0.01 ? 8 : 4;
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits,
  })}`;
}

export function formatEstimatedValueUsdc(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable';
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDC`;
}

export function formatWalletAddress(address?: string | null): string {
  const normalized = String(address ?? '').trim();
  if (normalized.length < 12) return normalized;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

export function formatMeeraUnitsFromWei(rawValue: string | bigint | null | undefined): string | null {
  if (rawValue == null) return null;
  const raw = typeof rawValue === 'bigint' ? rawValue : BigInt(rawValue);
  const decimals = BigInt(10) ** BigInt(MEERA_TOKEN.decimals);
  const integer = raw / decimals;
  const fraction = raw % decimals;
  const fractionText = fraction.toString().padStart(MEERA_TOKEN.decimals, '0').slice(0, 4);
  const trimmedFraction = fractionText.replace(/0+$/, '');
  return trimmedFraction ? `${integer.toString()}.${trimmedFraction}` : integer.toString();
}
