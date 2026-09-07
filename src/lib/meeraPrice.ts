import {
  MEERA_TOKEN,
  POLYGON_USDC_ADDRESSES,
  POLYGON_USDT_ADDRESS,
  isSameAddress,
  normalizeAddress,
  type MeeraPriceResponse,
  type MeeraTokenSummary,
} from '@/lib/meeraRewards';

const DEXSCREENER_TOKEN_PAIRS_URL =
  'https://api.dexscreener.com/token-pairs/v1/polygon/0xdeCd7dD35Cf8CB6A901871c2584B4d67718B5CB1';
const PRICE_CACHE_TTL_MS = 60_000;

type DexScreenerToken = {
  address?: string;
  symbol?: string;
  name?: string;
};

type DexScreenerPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: DexScreenerToken;
  quoteToken?: DexScreenerToken;
  priceUsd?: string | number;
  priceNative?: string | number;
  liquidity?: {
    usd?: string | number;
    base?: string | number;
    quote?: string | number;
  };
};

type CacheEntry = {
  expiresAt: number;
  value: MeeraPriceResponse;
};

let cache: CacheEntry | null = null;

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePairs(payload: unknown): DexScreenerPair[] {
  if (Array.isArray(payload)) return payload as DexScreenerPair[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as { pairs?: unknown }).pairs)) {
    return (payload as { pairs: DexScreenerPair[] }).pairs;
  }
  return [];
}

function tokenSummary(token?: DexScreenerToken): MeeraTokenSummary | null {
  if (!token?.address || !token?.symbol) return null;
  return {
    symbol: token.symbol,
    address: token.address,
  };
}

function isUsdcToken(token?: DexScreenerToken): boolean {
  const address = token?.address ? normalizeAddress(token.address) : '';
  const symbol = String(token?.symbol ?? '').trim().toUpperCase();
  return POLYGON_USDC_ADDRESSES.has(address) || symbol === 'USDC' || symbol === 'USDC.E';
}

function isUsdtToken(token?: DexScreenerToken): boolean {
  const address = token?.address ? normalizeAddress(token.address) : '';
  const symbol = String(token?.symbol ?? '').trim().toUpperCase();
  return address === POLYGON_USDT_ADDRESS || symbol === 'USDT';
}

function quotePriority(pair: DexScreenerPair): number {
  if (isUsdcToken(pair.quoteToken)) return 0;
  if (isUsdtToken(pair.quoteToken)) return 1;
  return 2;
}

function pairLiquidityUsd(pair: DexScreenerPair): number {
  return Math.max(toFiniteNumber(pair.liquidity?.usd) ?? 0, 0);
}

function selectBestPair(pairs: DexScreenerPair[]): DexScreenerPair | null {
  const eligiblePairs = pairs.filter((pair) => {
    const hasMeeraAsBase = isSameAddress(pair.baseToken?.address, MEERA_TOKEN.address);
    const priceUsd = toFiniteNumber(pair.priceUsd);
    return hasMeeraAsBase && priceUsd != null && priceUsd > 0;
  });

  eligiblePairs.sort((left, right) => {
    const priorityDelta = quotePriority(left) - quotePriority(right);
    if (priorityDelta !== 0) return priorityDelta;
    return pairLiquidityUsd(right) - pairLiquidityUsd(left);
  });

  return eligiblePairs[0] ?? null;
}

function buildResponseFromPair(pair: DexScreenerPair, fetchedAt: string): MeeraPriceResponse {
  return {
    priceUsdc: toFiniteNumber(pair.priceUsd),
    source: 'DEXSCREENER_LIVE',
    chainId: pair.chainId ?? 'polygon',
    dexId: pair.dexId ?? null,
    pairAddress: pair.pairAddress ?? null,
    baseToken: tokenSummary(pair.baseToken) ?? {
      symbol: MEERA_TOKEN.symbol,
      address: MEERA_TOKEN.address,
    },
    quoteToken: tokenSummary(pair.quoteToken),
    liquidityUsd: pairLiquidityUsd(pair),
    updatedAt: fetchedAt,
  };
}

function fallbackResponse(reason: unknown): MeeraPriceResponse {
  const fallback = toFiniteNumber(process.env.MEERA_PRICE_USDC_FALLBACK);
  if (fallback != null && fallback > 0) {
    console.warn('[MEERA_PRICE] DEX Screener live price unavailable; using emergency fallback.', {
      fallback,
      reason: reason instanceof Error ? reason.message : String(reason),
    });

    return {
      priceUsdc: fallback,
      source: 'FALLBACK',
      chainId: 'polygon',
      dexId: null,
      pairAddress: null,
      baseToken: {
        symbol: MEERA_TOKEN.symbol,
        address: MEERA_TOKEN.address,
      },
      quoteToken: null,
      liquidityUsd: null,
      updatedAt: new Date().toISOString(),
    };
  }

  console.warn('[MEERA_PRICE] DEX Screener live price unavailable and no fallback is configured.', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });

  return {
    priceUsdc: null,
    source: 'UNAVAILABLE',
    chainId: 'polygon',
    dexId: null,
    pairAddress: null,
    baseToken: {
      symbol: MEERA_TOKEN.symbol,
      address: MEERA_TOKEN.address,
    },
    quoteToken: null,
    liquidityUsd: null,
    updatedAt: null,
  };
}

export async function getMeeraPrice(options: { forceRefresh?: boolean } = {}): Promise<MeeraPriceResponse> {
  const now = Date.now();
  if (!options.forceRefresh && cache && cache.expiresAt > now) return cache.value;

  let response: MeeraPriceResponse;
  try {
    const dexResponse = await fetch(DEXSCREENER_TOKEN_PAIRS_URL, {
      headers: {
        accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!dexResponse.ok) {
      throw new Error(`DEX Screener responded with HTTP ${dexResponse.status}`);
    }

    const payload = (await dexResponse.json()) as unknown;
    const pairs = normalizePairs(payload);
    const selectedPair = selectBestPair(pairs);

    if (!selectedPair) {
      throw new Error(`No eligible MEERA base pair found in ${pairs.length} DEX Screener pair(s)`);
    }

    response = buildResponseFromPair(selectedPair, new Date().toISOString());
    console.info('[MEERA_PRICE] Using live DEX Screener price.', {
      source: response.source,
      dexId: response.dexId,
      pairAddress: response.pairAddress,
      quoteToken: response.quoteToken?.symbol,
      liquidityUsd: response.liquidityUsd,
      priceUsdc: response.priceUsdc,
    });
  } catch (error) {
    response = fallbackResponse(error);
  }

  cache = {
    expiresAt: now + PRICE_CACHE_TTL_MS,
    value: response,
  };

  return response;
}
