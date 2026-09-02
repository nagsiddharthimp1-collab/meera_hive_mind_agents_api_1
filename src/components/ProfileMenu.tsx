'use client';

import type { SubscriptionData } from '@/types/subscription';
import {
  calculateEstimatedValueUsdc,
  calculateMeeraEarned,
  formatEstimatedValueUsdc,
  formatMeeraPlain,
  type MeeraPriceResponse,
} from '@/lib/meeraRewards';
import { isPaidPlanActive } from '@/lib/subscriptionUtils';
import { MeeraRewardsDialog } from '@/components/MeeraRewardsDialog';
import React, { useEffect, useMemo, useState } from 'react';
import { FaCrown } from 'react-icons/fa6';
import { FiInfo, FiLogOut, FiSettings } from 'react-icons/fi';

interface ProfileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  tokensConsumed?: string | null;
  onUpgrade: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  subscriptionData?: SubscriptionData | null;
  isSubscriptionLoading?: boolean;
  anchor?: 'top-left' | 'sidebar-bottom';
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({
  isOpen,
  onClose,
  tokensConsumed,
  onUpgrade,
  onOpenSettings,
  onSignOut,
  subscriptionData,
  isSubscriptionLoading = false,
  anchor = 'sidebar-bottom',
}) => {
  const tokenText = String(tokensConsumed ?? '').trim() || '0';
  const [price, setPrice] = useState<MeeraPriceResponse | null>(null);
  const [isPriceLoading, setIsPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [isRewardsDialogOpen, setIsRewardsDialogOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setIsPriceLoading(true);
    setPriceError(null);

    fetch('/api/meera/price')
      .then(async (response) => {
        if (!response.ok) throw new Error(`Price request failed with ${response.status}`);
        return (await response.json()) as MeeraPriceResponse;
      })
      .then((nextPrice) => {
        if (!cancelled) setPrice(nextPrice);
      })
      .catch((error) => {
        if (!cancelled) {
          setPrice(null);
          setPriceError(error instanceof Error ? error.message : 'Unable to load price');
        }
      })
      .finally(() => {
        if (!cancelled) setIsPriceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const meeraEarned = useMemo(() => calculateMeeraEarned(tokenText), [tokenText]);
  const estimatedValue = useMemo(
    () => calculateEstimatedValueUsdc(meeraEarned, price?.priceUsdc ?? null),
    [meeraEarned, price?.priceUsdc],
  );

  if (!isOpen) return null;

  const hasActivePro = isPaidPlanActive(subscriptionData);
  const isPlanPending = isSubscriptionLoading || !subscriptionData;
  const isUpgradeDisabled = hasActivePro || isPlanPending;
  const upgradeLabel = isPlanPending ? 'Checking plan...' : hasActivePro ? 'Pro Activated' : 'Upgrade to Pro';
  const estimatedValueText = isPriceLoading
    ? 'Loading...'
    : priceError || price?.priceUsdc == null
      ? 'Unavailable'
      : formatEstimatedValueUsdc(estimatedValue);
  const estimatedUsdText = estimatedValueText.replace(/\s+USDC$/, '');

  const menuPositionClass =
    anchor === 'top-left'
      ? 'top-16 left-4 w-[min(92vw,340px)]'
      : 'bottom-16 left-2 w-[calc(84vw-16px)] max-w-[304px] md:w-[244px]';

  return (
    <div className="fixed inset-0 z-50">
      <button
        onClick={onClose}
        className="absolute inset-0 bg-transparent"
        aria-label="Close profile menu backdrop"
      />

      <section className={`absolute ${menuPositionClass} rounded-xl border border-primary/20 bg-background shadow-xl`}>
        <div className="p-3 border-b border-primary/15">
          <button
            onClick={isUpgradeDisabled ? undefined : onUpgrade}
            disabled={isUpgradeDisabled}
            className={`w-full flex items-center justify-center gap-2 rounded-lg border border-primary/20 bg-background px-3 py-2.5 text-sm transition-colors ${
              isUpgradeDisabled ? 'cursor-default text-primary/80' : 'text-primary hover:bg-primary/10'
            }`}
          >
            <FaCrown size={14} className={hasActivePro ? 'text-yellow-500' : undefined} />
            <span className="font-medium">{upgradeLabel}</span>
          </button>
        </div>

        <div className="px-3 pt-2 pb-2.5 border-b border-primary/15 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-primary">#MEERA Tokens Earned</p>
            <button
              type="button"
              onClick={() => setIsRewardsDialogOpen(true)}
              className="grid h-6 w-6 place-items-center rounded-md text-primary/70 transition-colors hover:bg-primary/10 hover:text-primary"
              aria-label="Open MEERA Rewards"
              title="AI tokens are consumed when you use Meera. Your usage is converted into MEERA rewards."
            >
              <FiInfo size={14} />
            </button>
          </div>
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-base font-medium text-primary">{formatMeeraPlain(meeraEarned)}</p>
              <p className="shrink-0 text-right text-xs font-semibold text-primary/70">
                {estimatedUsdText}
              </p>
            </div>
          </div>
        </div>

        <footer className="p-2 space-y-1">
          <button
            onClick={onOpenSettings}
            className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-primary hover:bg-primary/10 transition-colors flex items-center gap-2"
          >
            <FiSettings size={16} />
            <span>Settings</span>
          </button>
          <button
            onClick={onSignOut}
            className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-primary hover:bg-primary/10 transition-colors flex items-center gap-2"
          >
            <FiLogOut size={16} />
            <span>Sign out</span>
          </button>
        </footer>
      </section>

      <MeeraRewardsDialog isOpen={isRewardsDialogOpen} onClose={() => setIsRewardsDialogOpen(false)} />
    </div>
  );
};
