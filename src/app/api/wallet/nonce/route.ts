import { MEERA_TOKEN, normalizeAddress } from '@/lib/meeraRewards';
import { requireAuthenticatedUser } from '@/lib/meeraServer';
import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function isValidWalletAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { walletAddress?: string };
  try {
    body = (await request.json()) as { walletAddress?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const walletAddress = String(body.walletAddress ?? '').trim();
  if (!isValidWalletAddress(walletAddress)) {
    return NextResponse.json({ error: 'Invalid wallet address.' }, { status: 400 });
  }

  const normalizedWalletAddress = normalizeAddress(walletAddress);
  const nonce = `${randomUUID()}:${randomBytes(16).toString('hex')}`;
  const timestamp = new Date();
  const expiresAt = new Date(timestamp.getTime() + 10 * 60 * 1000);
  const message = [
    'Sign this message to connect your wallet to Meera.',
    '',
    'This does not cost gas.',
    'This does not give Meera permission to move your funds.',
    '',
    `User ID: ${auth.user.id}`,
    `Wallet: ${normalizedWalletAddress}`,
    `Timestamp: ${timestamp.toISOString()}`,
    `Nonce: ${nonce}`,
  ].join('\n');

  const { error: cleanupError } = await auth.supabase
    .from('wallet_nonces')
    .delete()
    .eq('user_id', auth.user.id)
    .lt('expires_at', timestamp.toISOString());

  if (cleanupError) {
    console.warn('[MEERA_WALLET] Expired nonce cleanup failed.', {
      message: cleanupError.message,
    });
  }

  const { error } = await auth.supabase.from('wallet_nonces').insert({
    user_id: auth.user.id,
    wallet_address: normalizedWalletAddress,
    nonce,
    message,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    console.warn('[MEERA_WALLET] Failed to create wallet nonce.', {
      userId: auth.user.id,
      walletAddress: normalizedWalletAddress,
      message: error.message,
    });
    return NextResponse.json({ error: 'Failed to create wallet verification message.' }, { status: 500 });
  }

  return NextResponse.json({
    nonce,
    message,
    chainId: MEERA_TOKEN.chainId,
    walletAddress: normalizedWalletAddress,
    expiresAt: expiresAt.toISOString(),
  });
}
