'use client';

import {
  calculateEstimatedValueUsdc,
  formatEstimatedValueUsdc,
  formatInteger,
  formatMeeraPlain,
} from '@/lib/meeraRewards';
import { supabase } from '@/lib/supabaseClient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiRefreshCw, FiX } from 'react-icons/fi';

type RewardsSummary = {
  aiTokensConsumedLifetimeFormatted: string;
  aiTokensPerMeera: number;
  meeraEarnedLifetime: number;
  currentMeeraPriceUsdc: number | null;
  estimatedValueUsdc: number | null;
};

type MeeraRewardsDialogProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function MeeraRewardsDialog({ isOpen, onClose }: MeeraRewardsDialogProps) {
  const [summary, setSummary] = useState<RewardsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error('Please sign in to view your Meera Wallet.');
      const response = await fetch('/api/meera/rewards/summary', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load your Meera Wallet.');
      setSummary(payload as RewardsSummary);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load your Meera Wallet.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void loadSummary();
  }, [isOpen, loadSummary]);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab') return;
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;
  const estimatedValue = summary
    ? summary.estimatedValueUsdc ?? calculateEstimatedValueUsdc(summary.meeraEarnedLifetime, summary.currentMeeraPriceUsdc)
    : null;
  const estimatedValueText = formatEstimatedValueUsdc(estimatedValue).replace(/\s+USDC$/, '');

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/75 px-3 py-4 text-primary backdrop-blur-sm sm:px-5">
      <button type="button" tabIndex={-1} className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close Meera Wallet backdrop" />
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="meera-wallet-title" tabIndex={-1} className="relative w-full max-w-[500px] overflow-hidden rounded-2xl border border-primary/15 bg-background shadow-[0_24px_80px_rgba(12,60,38,0.16)] outline-none">
        <header className="flex items-center justify-between border-b border-primary/10 px-4 py-3 sm:px-5">
          <h2 id="meera-wallet-title" className="text-lg font-semibold">Meera Wallet</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={loadSummary} disabled={isLoading} className="grid h-8 w-8 place-items-center rounded-lg text-primary/70 transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Refresh Meera Wallet">
              <FiRefreshCw size={15} className={isLoading ? 'animate-spin' : undefined} />
            </button>
            <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-primary/75 transition-colors hover:bg-primary/10" aria-label="Close Meera Wallet">
              <FiX size={18} />
            </button>
          </div>
        </header>
        <div className="p-4 sm:p-5">
          {errorMessage ? <p role="alert" className="mb-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-700">{errorMessage}</p> : null}
          <div aria-busy={isLoading} className="rounded-xl border border-primary/15 bg-primary/5 p-4">
            {!summary ? (
              <div role="status" className="flex min-h-[90px] items-center justify-center gap-3 text-sm text-primary/60">
                {isLoading ? <><div className="h-6 w-6 animate-spin rounded-full border-4 border-primary/15 border-t-primary" />Loading your coins...</> : 'Coin balance unavailable'}
              </div>
            ) : (
              <>
                <p className="text-xs font-medium text-primary/60">Coins earned</p>
                <p className="mt-2 break-words text-3xl font-semibold leading-tight sm:text-4xl">{formatMeeraPlain(summary.meeraEarnedLifetime, 6)}</p>
                <p className="mt-1 text-sm text-primary/60">Meera Coins</p>
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-primary/10 pt-3 text-sm">
                  <span className="text-primary/60">Estimated value</span>
                  <span className="font-semibold">{estimatedValueText}</span>
                </div>
              </>
            )}
          </div>
          {summary ? (
            <div className="mt-3 rounded-xl border border-primary/10 px-4 py-3">
              <dl className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <dt className="text-primary/60">Intelligence Tokens Consumed</dt>
                <dd className="break-words font-semibold">{summary.aiTokensConsumedLifetimeFormatted}</dd>
              </dl>
              <p className="mt-2 text-xs leading-5 text-primary/60">
                {formatInteger(summary.aiTokensPerMeera)} Intelligence Tokens = 1 Meera Coin
              </p>
            </div>
          ) : null}
          <p className="mt-4 text-sm leading-6 text-primary/60">You earn Meera Coins by using Meera. This wallet shows the total coins you have earned.</p>
        </div>
      </section>
    </div>
  );
}
