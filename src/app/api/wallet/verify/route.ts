import { MEERA_TOKEN, normalizeAddress } from '@/lib/meeraRewards';
import { requireAuthenticatedUser } from '@/lib/meeraServer';
import { verifyMessage } from 'ethers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type WalletNonceRow = {
  id: string;
  user_id: string;
  wallet_address: string;
  nonce: string;
  message: string;
  expires_at: string;
  consumed_at: string | null;
};

function isValidWalletAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: {
    walletAddress?: string;
    signature?: string;
    nonce?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const walletAddress = String(body.walletAddress ?? '').trim();
  const signature = String(body.signature ?? '').trim();
  const nonce = String(body.nonce ?? '').trim();

  if (!isValidWalletAddress(walletAddress)) {
    return NextResponse.json({ error: 'Invalid wallet address.' }, { status: 400 });
  }
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }
  if (!nonce) {
    return NextResponse.json({ error: 'Missing nonce.' }, { status: 400 });
  }

  const normalizedWalletAddress = normalizeAddress(walletAddress);

  const { data: nonceRow, error: nonceError } = await auth.supabase
    .from('wallet_nonces')
    .select('id, user_id, wallet_address, nonce, message, expires_at, consumed_at')
    .eq('user_id', auth.user.id)
    .eq('wallet_address', normalizedWalletAddress)
    .eq('nonce', nonce)
    .maybeSingle();

  if (nonceError) {
    console.warn('[MEERA_WALLET] Failed to load wallet nonce.', {
      userId: auth.user.id,
      walletAddress: normalizedWalletAddress,
      message: nonceError.message,
    });
    return NextResponse.json({ error: 'Unable to verify wallet at this time.' }, { status: 500 });
  }

  const walletNonce = nonceRow as WalletNonceRow | null;
  if (!walletNonce || walletNonce.consumed_at) {
    return NextResponse.json({ error: 'Wallet verification message expired. Please try again.' }, { status: 400 });
  }

  if (Date.parse(walletNonce.expires_at) <= Date.now()) {
    return NextResponse.json({ error: 'Wallet verification message expired. Please try again.' }, { status: 400 });
  }

  let recoveredAddress = '';
  try {
    recoveredAddress = verifyMessage(walletNonce.message, signature);
  } catch (error) {
    console.warn('[MEERA_WALLET] Signature recovery failed.', {
      userId: auth.user.id,
      walletAddress: normalizedWalletAddress,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Wallet connection was cancelled. Please sign the message to verify wallet ownership.' },
      { status: 400 },
    );
  }

  if (normalizeAddress(recoveredAddress) !== normalizedWalletAddress) {
    return NextResponse.json({ error: 'Signature does not match this wallet address.' }, { status: 400 });
  }

  const { data: existingWalletOwner, error: existingWalletError } = await auth.supabase
    .from('wallet_links')
    .select('user_id')
    .eq('wallet_address', normalizedWalletAddress)
    .maybeSingle();

  if (existingWalletError) {
    return NextResponse.json({ error: 'Unable to verify wallet at this time.' }, { status: 500 });
  }

  if (
    (existingWalletOwner as { user_id?: string } | null)?.user_id &&
    (existingWalletOwner as { user_id: string }).user_id !== auth.user.id
  ) {
    return NextResponse.json({ error: 'This wallet is already linked to another Meera account.' }, { status: 409 });
  }

  const { data: existingUserWallet, error: existingUserWalletError } = await auth.supabase
    .from('wallet_links')
    .select('wallet_address')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (existingUserWalletError) {
    return NextResponse.json({ error: 'Unable to verify wallet at this time.' }, { status: 500 });
  }

  if (
    (existingUserWallet as { wallet_address?: string } | null)?.wallet_address &&
    normalizeAddress((existingUserWallet as { wallet_address: string }).wallet_address) !== normalizedWalletAddress
  ) {
    return NextResponse.json({ error: 'This Meera account already has another wallet linked.' }, { status: 409 });
  }

  const verifiedAt = new Date().toISOString();
  const { error: linkError } = await auth.supabase.from('wallet_links').upsert(
    {
      user_id: auth.user.id,
      wallet_address: normalizedWalletAddress,
      chain_id: MEERA_TOKEN.chainId,
      signature,
      nonce,
      verified_at: verifiedAt,
      updated_at: verifiedAt,
    },
    {
      onConflict: 'user_id',
    },
  );

  if (linkError) {
    console.warn('[MEERA_WALLET] Failed to link wallet.', {
      userId: auth.user.id,
      walletAddress: normalizedWalletAddress,
      message: linkError.message,
    });
    return NextResponse.json({ error: 'Failed to link wallet.' }, { status: 500 });
  }

  const { error: consumeError } = await auth.supabase
    .from('wallet_nonces')
    .update({ consumed_at: verifiedAt })
    .eq('id', walletNonce.id);

  if (consumeError) {
    console.warn('[MEERA_WALLET] Failed to mark nonce consumed.', {
      nonceId: walletNonce.id,
      message: consumeError.message,
    });
  }

  return NextResponse.json({
    success: true,
    walletAddress: normalizedWalletAddress,
    linked: true,
    chainId: MEERA_TOKEN.chainId,
  });
}
