import { getMeeraPrice } from '@/lib/meeraPrice';
import { createSupabaseAdminClient } from '@/lib/meeraServer';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function bestEffortRecordPriceSnapshot(price: Awaited<ReturnType<typeof getMeeraPrice>>) {
  const supabase = createSupabaseAdminClient();
  if (!supabase || price.source === 'UNAVAILABLE') return;

  const { error } = await supabase.from('meera_price_snapshots').insert({
    source: price.source,
    pair_address: price.pairAddress,
    dex_id: price.dexId,
    quote_token_symbol: price.quoteToken?.symbol ?? null,
    quote_token_address: price.quoteToken?.address ?? null,
    meera_price_usdc: price.priceUsdc,
    liquidity_usdc: price.liquidityUsd,
    metadata: {
      chainId: price.chainId ?? null,
      baseToken: price.baseToken ?? null,
      quoteToken: price.quoteToken ?? null,
    },
  });

  if (error) {
    console.warn('[MEERA_PRICE] Failed to persist price snapshot.', {
      message: error.message,
      source: price.source,
    });
  }
}

export async function GET() {
  const price = await getMeeraPrice();
  await bestEffortRecordPriceSnapshot(price);

  return NextResponse.json(price, {
    status: 200,
    headers: {
      'Cache-Control': 'private, max-age=30',
    },
  });
}
