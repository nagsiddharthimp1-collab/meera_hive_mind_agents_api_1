'use client';

import {
  MEERA_TOKEN,
  calculateEstimatedValueUsdc,
  formatEstimatedValueUsdc,
  formatMeeraPlain,
  formatPriceUsd,
  formatWalletAddress,
  type MeeraPriceResponse,
} from '@/lib/meeraRewards';
import { supabase } from '@/lib/supabaseClient';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiPlusCircle, FiRefreshCw, FiShield, FiX } from 'react-icons/fi';

type RewardsSummary = {
  aiTokensConsumedLifetimeFormatted: string;
  meeraEarnedLifetime: number;
  currentMeeraPriceUsdc: number | null;
  estimatedValueUsdc: number | null;
  price: MeeraPriceResponse;
  walletAddress: string | null;
  activeRewardEpoch: string;
};

type WalletNonceResponse = {
  nonce: string;
  message: string;
  walletAddress: string;
  expiresAt: string;
};

type WalletVerifyResponse = {
  success: boolean;
  walletAddress: string;
  linked: boolean;
};

type MeeraRewardsDialogProps = {
  isOpen: boolean;
  onClose: () => void;
};

const POLYGON_CHAIN_PARAMS = {
  chainId: MEERA_TOKEN.chainHexId,
  chainName: MEERA_TOKEN.networkName,
  nativeCurrency: {
    name: 'POL',
    symbol: 'POL',
    decimals: 18,
  },
  rpcUrls: ['https://polygon-rpc.com'],
  blockExplorerUrls: ['https://polygonscan.com'],
};

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authenticatedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Authentication required.');

  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return payload as T;
}

async function ensurePolygonNetwork() {
  if (!window.ethereum) throw new Error('MetaMask not detected. Please install MetaMask to connect your wallet.');

  const chainId = await window.ethereum.request<string>({ method: 'eth_chainId' });
  if (String(chainId).toLowerCase() === MEERA_TOKEN.chainHexId) return;

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: MEERA_TOKEN.chainHexId }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw new Error('Please switch to Polygon Mainnet to use MEERA rewards.');
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [POLYGON_CHAIN_PARAMS],
    });
  }
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-primary/10 py-2.5 last:border-b-0">
      <dt className="min-w-0 text-xs font-medium leading-4 text-primary/55">{label}</dt>
      <dd className="max-w-[150px] truncate text-right text-sm font-medium text-primary sm:max-w-none">{value}</dd>
    </div>
  );
}

export function MeeraRewardsDialog({ isOpen, onClose }: MeeraRewardsDialogProps) {
  const [summary, setSummary] = useState<RewardsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAddingToken, setIsAddingToken] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextSummary = await authenticatedJson<RewardsSummary>('/api/meera/rewards/summary');
      setSummary(nextSummary);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load MEERA rewards.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setStatusMessage(null);
    loadSummary();
  }, [isOpen, loadSummary]);

  const walletAddress = summary?.walletAddress ?? null;
  const earnedText = formatMeeraPlain(summary?.meeraEarnedLifetime ?? 0, 6);
  const estimatedValue = useMemo(() => {
    if (!summary) return null;
    return summary.estimatedValueUsdc ?? calculateEstimatedValueUsdc(summary.meeraEarnedLifetime, summary.currentMeeraPriceUsdc);
  }, [summary]);
  const estimatedValueText = estimatedValue == null ? 'Unavailable' : formatEstimatedValueUsdc(estimatedValue);
  const currentPriceText =
    !summary?.price || summary.price.source === 'UNAVAILABLE' || summary.currentMeeraPriceUsdc == null
      ? 'Unavailable'
      : formatPriceUsd(summary.currentMeeraPriceUsdc);
  const walletStatusText = walletAddress ? formatWalletAddress(walletAddress) : 'Not connected';
  const tokenText = summary?.aiTokensConsumedLifetimeFormatted ?? '0';

  const handleConnectWallet = async () => {
    setIsConnecting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      if (!window.ethereum) {
        throw new Error('MetaMask not detected. Please install MetaMask to connect your wallet.');
      }

      const accounts = await window.ethereum.request<string[]>({
        method: 'eth_requestAccounts',
      });
      const walletAddress = accounts[0];
      if (!walletAddress) throw new Error('MetaMask did not return a wallet address.');

      await ensurePolygonNetwork();

      const nonceResponse = await authenticatedJson<WalletNonceResponse>('/api/wallet/nonce', {
        method: 'POST',
        body: JSON.stringify({ walletAddress }),
      });

      const signature = await window.ethereum.request<string>({
        method: 'personal_sign',
        params: [nonceResponse.message, walletAddress],
      });

      const verifyResponse = await authenticatedJson<WalletVerifyResponse>('/api/wallet/verify', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          signature,
          nonce: nonceResponse.nonce,
        }),
      });

      if (!verifyResponse.success || !verifyResponse.linked) {
        throw new Error('Wallet could not be linked.');
      }

      setStatusMessage('Wallet connected.');
      await loadSummary();
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 4001) {
        setErrorMessage('Wallet connection was cancelled. Please sign the message to verify wallet ownership.');
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to connect wallet.');
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleAddMeeraToMetaMask = async () => {
    setIsAddingToken(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      if (!window.ethereum) {
        throw new Error('MetaMask not detected. Please install MetaMask to add MEERA.');
      }

      await window.ethereum.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: MEERA_TOKEN.address,
            symbol: MEERA_TOKEN.symbol,
            decimals: MEERA_TOKEN.decimals,
            image: MEERA_TOKEN.logoUrl,
          },
        },
      });
      setStatusMessage('MEERA added to MetaMask.');
    } catch {
      setErrorMessage('Could not add MEERA to MetaMask. Please try again.');
    } finally {
      setIsAddingToken(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/75 px-3 py-4 text-primary backdrop-blur-sm sm:px-5">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close rewards" />

      <section className="relative w-full max-w-[500px] overflow-hidden rounded-2xl border border-primary/15 bg-background shadow-[0_24px_80px_rgba(12,60,38,0.16)]">
        <div className="absolute left-3 right-3 top-3 z-10 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-primary/75 transition-colors hover:bg-primary/10 hover:text-primary"
            aria-label="Close MEERA rewards"
          >
            <FiX size={18} />
          </button>
          <button
            type="button"
            onClick={loadSummary}
            disabled={isLoading}
            className="grid h-8 w-8 place-items-center rounded-lg text-primary/70 transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Refresh MEERA rewards"
          >
            <FiRefreshCw size={15} className={isLoading ? 'animate-spin' : undefined} />
          </button>
        </div>

        <div className="p-4 pt-12 sm:p-5 sm:pt-12">
          {errorMessage ? (
            <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-700">
              {errorMessage}
            </div>
          ) : null}

          {statusMessage ? (
            <div className="mb-3 rounded-lg border border-primary/15 bg-primary/10 px-3 py-2 text-xs text-primary">
              {statusMessage}
            </div>
          ) : null}

          <div className="rounded-xl border border-primary/15 bg-primary/5 p-4">
            {isLoading && !summary ? (
              <div className="flex h-[78px] items-center justify-center">
                <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary/15 border-t-primary" />
              </div>
            ) : (
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-3xl font-semibold leading-none text-primary sm:text-4xl">{earnedText}</p>
                  <p className="mt-2 text-xs font-medium text-primary/55">{MEERA_TOKEN.symbol}</p>
                </div>
                <div className="shrink-0 pb-0.5 text-right">
                  <p className="text-xs font-medium text-primary/50">Estimated</p>
                  <p className="mt-1 text-sm font-semibold text-primary">{estimatedValueText}</p>
                </div>
              </div>
            )}
          </div>

          <dl className="mt-3 rounded-xl border border-primary/10 px-3">
            <DetailRow label="Intelligence Tokens" value={tokenText} />
            <DetailRow label="Pool Price" value={currentPriceText} />
            <DetailRow label="Epoch" value={summary?.activeRewardEpoch ?? 'Genesis'} />
            <DetailRow label="Wallet" value={walletStatusText} />
          </dl>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {!walletAddress ? (
              <button
                type="button"
                onClick={handleConnectWallet}
                disabled={isConnecting || isLoading}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FiShield size={16} />
                {isConnecting ? 'Connecting' : 'Connect'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleAddMeeraToMetaMask}
              disabled={isAddingToken || isLoading}
              className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-primary/20 px-4 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60 ${
                walletAddress ? 'sm:col-span-2' : ''
              }`}
            >
              <FiPlusCircle size={16} />
              {isAddingToken ? 'Adding' : 'Add MEERA'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
