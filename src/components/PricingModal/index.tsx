'use client';

import { paymentService } from '@/app/api/services/payment';
import { trackingService } from '@/app/api/services/tracking';
import { SUBSCRIPTION_QUERY_KEY } from '@/hooks/useSubscriptionStatus';
import { supabase } from '@/lib/supabaseClient';
import type { CashfreeInstance, PlanType, PricingModalProps, PricingModalSource } from '@/types/pricing';
import { load } from '@cashfreepayments/cashfree-js';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import Image from 'next/image';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { HiArrowLeft } from 'react-icons/hi2';
import meeraLogo from '../../../public/icons/meera.svg';
import starBg from '../../../public/images/star.png';
import { COUPON_CODES, PLAN_COMPARE_AT_PRICES, PLAN_PRICES } from './constants';

// Helper functions
const calculateDiscountedPrice = (price: number, discountPercentage: number): number => {
  const discount = (price * discountPercentage) / 100;
  return Math.round(price - discount);
};

const getPriceDisplay = (plan: PlanType, basePrice: number, discountedPrice: number | null): ReactNode => {
  const compareAtPrice = PLAN_COMPARE_AT_PRICES[plan];
  const currentPrice = discountedPrice ?? basePrice;
  const discountPercent = Math.max(0, Math.round(((compareAtPrice - currentPrice) / compareAtPrice) * 100));

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="line-through text-white/45">₹{compareAtPrice}</span>
      <span className="text-white font-semibold">₹{currentPrice}</span>
      <span className="rounded-full border border-green-300/30 bg-green-300/10 px-2 py-0.5 text-[10px] font-semibold leading-none text-green-200">
        {discountPercent}% off
      </span>
      {currentPrice === 0 && <span className="text-green-300 text-xs font-medium">(Free)</span>}
    </div>
  );
};

const CONFETTI_COLORS = ['#F59E0B', '#34D399', '#60A5FA', '#F472B6', '#F97316', '#A78BFA'] as const;
const CONFETTI_PIECES = Array.from({ length: 28 }, (_, index) => ({
  id: index,
  left: `${Math.round((index / 28) * 100)}%`,
  delay: (index % 7) * 0.08,
  duration: 1.8 + (index % 5) * 0.18,
  drift: index % 2 === 0 ? 16 : -16,
  spin: index % 2 === 0 ? 220 : -220,
}));

const getErrorStatus = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null;
  if ('status' in error && typeof error.status === 'number') return error.status;
  return null;
};

export const PricingModal = ({ isOpen, onClose, isClosable, source }: PricingModalProps) => {
  const [showEntryCode, setShowEntryCode] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanType>('lifetime');
  const [entryCode, setEntryCode] = useState('');
  const [cashfree, setCashfree] = useState<CashfreeInstance | null>(null);
  const [isPaymentLoading, setIsPaymentLoading] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [showSuccessCelebration, setShowSuccessCelebration] = useState(false);
  const [discountedPrices, setDiscountedPrices] = useState<{
    monthly: number | null;
    lifetime: number | null;
  }>({ monthly: null, lifetime: null });

  const queryClient = useQueryClient();
  const hasTrackedOpenRef = useRef(false);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalPanelRef = useRef<HTMLDivElement | null>(null);
  const [isDesktopModal, setIsDesktopModal] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 640px)');
    const syncViewportMode = () => setIsDesktopModal(mediaQuery.matches);
    syncViewportMode();
    mediaQuery.addEventListener('change', syncViewportMode);
    return () => mediaQuery.removeEventListener('change', syncViewportMode);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const panel = modalPanelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const focusFirstControl = window.requestAnimationFrame(() => {
      const firstControl = panel?.querySelector<HTMLElement>(focusableSelector);
      (firstControl ?? panel)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isClosable) onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.offsetParent !== null,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFirstControl);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      previouslyFocused?.focus();
    };
  }, [isClosable, isOpen, onClose]);

  useEffect(() => {
    if (isOpen && source) {
      if (!hasTrackedOpenRef.current) {
        trackingService.trackModalOpen(source as PricingModalSource);
        hasTrackedOpenRef.current = true;
      }
    } else {
      hasTrackedOpenRef.current = false;
    }
  }, [isOpen, source]);

  useEffect(() => {
    const initializeCashfree = async () => {
      const rawMode = process.env.NEXT_PUBLIC_CASHFREE_MODE?.toLowerCase();
      const cashfreeMode: 'sandbox' | 'production' = rawMode === 'production' ? 'production' : 'sandbox';
      const cfInstance = await load({
        mode: cashfreeMode,
      });
      setCashfree(cfInstance);
    };
    initializeCashfree();
  }, []);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setShowSuccessCelebration(false);
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }
    }
  }, [isOpen]);

  // Update both plan prices when coupon is applied/removed
  const updatePricesWithCoupon = (couponCode: string | null) => {
    if (!couponCode) {
      setDiscountedPrices({ monthly: null, lifetime: null });
      return;
    }

    const discountPercentage = COUPON_CODES[couponCode as keyof typeof COUPON_CODES];
    if (discountPercentage) {
      setDiscountedPrices({
        monthly: calculateDiscountedPrice(PLAN_PRICES.monthly, discountPercentage),
        lifetime: calculateDiscountedPrice(PLAN_PRICES.lifetime, discountPercentage),
      });
    }
  };

  const handleCouponCode = () => {
    const normalizedEntryCode = entryCode.trim().toUpperCase();
    if (normalizedEntryCode.length > 0) {
      const discountPercentage = COUPON_CODES[normalizedEntryCode as keyof typeof COUPON_CODES];

      if (discountPercentage) {
        setAppliedCoupon(normalizedEntryCode);
        updatePricesWithCoupon(normalizedEntryCode);
        setEntryCode(normalizedEntryCode);
        toast.success('Coupon applied successfully!');
        setShowEntryCode(false);
      } else {
        toast.error('Invalid coupon code');
      }
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon('');
    updatePricesWithCoupon(null);
    setEntryCode('');
  };

  // Get current price based on plan and discount
  const getCurrentPrice = (plan: PlanType) => {
    return discountedPrices[plan] ?? PLAN_PRICES[plan];
  };

  const setPaidSubscriptionState = (subscriptionEndDate: string | null) => {
    const resolvedSubscriptionEndDate = typeof subscriptionEndDate === 'string' ? subscriptionEndDate : null;

    queryClient.setQueryData(SUBSCRIPTION_QUERY_KEY, {
      plan_type: 'paid',
      status: 'active',
      is_pro: true,
      subscription_end_date: resolvedSubscriptionEndDate,
      talktime_left: 0,
      tokens_left: 100,
      message: 'PRO activated',
      is_paid_active: true,
      requires_payment_for_chat: false,
      free_chat_limit_reached: false,
      free_chat_turns_remaining: 0,
    });

    queryClient.setQueriesData({ queryKey: SUBSCRIPTION_QUERY_KEY }, (existing) => {
      const current = (existing as Record<string, unknown> | undefined) ?? {};
      const currentTalktime = typeof current.talktime_left === 'number' ? current.talktime_left : 0;
      const currentTokens = typeof current.tokens_left === 'number' ? current.tokens_left : 0;

      return {
        ...current,
        plan_type: 'paid',
        status: 'active',
        is_pro: true,
        subscription_end_date: resolvedSubscriptionEndDate,
        talktime_left: currentTalktime,
        tokens_left: currentTokens > 0 ? currentTokens : 100,
        message: 'PRO activated',
        is_paid_active: true,
        requires_payment_for_chat: false,
        free_chat_limit_reached: false,
      };
    });
  };

  const refreshSubscriptionState = async () => {
    try {
      const response = await paymentService.getSubscriptionStatus(true);
      if (response.plan_type === 'paid') {
        setPaidSubscriptionState(
          typeof response.subscription_end_date === 'string' ? response.subscription_end_date : null,
        );
      }
    } catch (error) {
      console.warn('Unable to refresh subscription after payment:', error);
    }

    await queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_QUERY_KEY });
    await queryClient.refetchQueries({ queryKey: SUBSCRIPTION_QUERY_KEY, type: 'active' });
  };

  const finishWithCelebration = () => {
    setShowSuccessCelebration(true);
    toast.success('Your PRO is activated 🚀', { duration: 5000 });

    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = setTimeout(() => {
      setShowSuccessCelebration(false);
      onClose();
    }, 2200);
  };

  const handleSubscribe = async () => {
    try {
      setIsPaymentLoading(true);

      const response = await paymentService.createPayment({
        plan_type: selectedPlan,
        amount: getCurrentPrice(selectedPlan),
        order_currency: 'INR',
        ...(appliedCoupon && { coupon_code: appliedCoupon }),
      });

      const data = response as {
        payment_session_id?: string;
        payment_status?: string;
        order_id?: string;
        data?: {
          payment_session_id?: string;
          payment_status?: string;
          order_id?: string;
        };
      };
      console.log('Backend Response:', data);

      const paymentStatus = data.payment_status || data.data?.payment_status;
      const sessionId = data.payment_session_id || data.data?.payment_session_id;
      const orderId = data.order_id || data.data?.order_id;

      // Handle 100% discount or BYPASS coupon case
      if (typeof paymentStatus === 'string' && paymentStatus.toLowerCase() === 'paid') {
        await refreshSubscriptionState();
        finishWithCelebration();
        return;
      }

      // Regular payment flow
      if (!sessionId) {
        const fullResponse = JSON.stringify(data, null, 2);
        alert(`Payment session ID is missing.\n\nBackend response:\n${fullResponse}`);
        toast.error('Unable to start payment. Please try again.');
        return;
      }

      if (!cashfree || typeof cashfree.checkout !== 'function') {
        toast.error('Payment gateway is not ready. Please try again in a moment.');
        return;
      }

      if (!orderId) {
        const fullResponse = JSON.stringify(data, null, 2);
        alert(`Order ID is missing.\n\nBackend response:\n${fullResponse}`);
        toast.error('Payment verification could not start. Please try again.');
        return;
      }

      let verificationHandled = false;

      console.log('[DEBUG] Calling cashfree.checkout...');

      await cashfree
        .checkout({
          paymentSessionId: sessionId,
          redirectTarget: '_modal',
        })
        .then(async (result) => {
          console.log('[DEBUG] Checkout promise RESOLVED:', result);
          if (result && typeof result === 'object' && 'paymentDetails' in result && result.paymentDetails) {
            verificationHandled = true;

            let verifyResponse:
              | {
                  success?: boolean;
                  status?: string;
                  payment_status?: string;
                  subscription?: {
                    status?: string;
                    subscription_end_date?: string | null;
                  };
                  data?: {
                    payment_status?: string;
                    subscription_end_date?: string | null;
                  };
                }
              | undefined;

            try {
              verifyResponse = await paymentService.verifyPayment({
                order_id: orderId,
                plan_type: selectedPlan,
              });
            } catch (verifyError) {
              console.error('Payment verification request failed:', verifyError);
              toast.error('Payment verification failed. Please contact support.');
              return;
            }

            const verifyData = verifyResponse || {};
            console.log('Verify Response:', verifyData);

            const verifyStatus =
              verifyData.data?.payment_status ||
              verifyData.payment_status ||
              verifyData.subscription?.status ||
              verifyData.status ||
              '';
            const normalizedVerifyStatus = String(verifyStatus).toLowerCase();
            const isPaid =
              normalizedVerifyStatus === 'paid' ||
              normalizedVerifyStatus === 'active' ||
              (verifyData.success === true && normalizedVerifyStatus.length === 0);

            if (!isPaid) {
              toast.error('Payment verification failed. Please contact support.');
              return;
            }

            const resolvedSubscriptionEndDate =
              verifyData.data?.subscription_end_date ?? verifyData.subscription?.subscription_end_date ?? null;

            setPaidSubscriptionState(
              typeof resolvedSubscriptionEndDate === 'string' ? resolvedSubscriptionEndDate : null,
            );
            await refreshSubscriptionState();
            finishWithCelebration();
          }
        })
        .catch((error) => {
          console.error('[DEBUG] Checkout promise REJECTED:', error);
        })
        .finally(() => {
          console.log('[DEBUG] Checkout promise SETTLED (finished)');
        });

      if (!verificationHandled) {
        toast.error('Payment was not completed. Please try again.');
        return;
      }
    } catch (error) {
      console.error('Payment failed:', error);
      if (getErrorStatus(error) === 401) {
        toast.error('Session expired. Please sign in again to complete payment.');
        return;
      }
      toast.error('Payment failed. Please try again.');
    } finally {
      setIsPaymentLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      localStorage.clear();
      await supabase.auth.signOut();
      window.location.href = '/sign-in';
    } catch (error) {
      console.error('Logout failed:', error);
      toast.error('Unable to log out. Please try again.');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[9998]"
            onClick={isClosable ? onClose : undefined}
          />

          {/* Modal Container */}
          <motion.div
            ref={modalPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pricing-modal-title"
            tabIndex={-1}
            initial={isDesktopModal ? { opacity: 0, scale: 0.96, y: 0 } : { opacity: 0, scale: 1, y: '100%' }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={isDesktopModal ? { opacity: 0, scale: 0.96, y: 0 } : { opacity: 0, scale: 1, y: '100%' }}
            className="fixed z-[9999] bottom-0 left-0 right-0 h-[calc(100dvh-8px)] rounded-t-3xl
                       sm:inset-0 sm:m-auto sm:w-[min(580px,calc(100vw-32px))] sm:h-[calc(100dvh-32px)] sm:max-h-[760px] sm:rounded-[24px]
                       px-5 py-4 sm:px-11 sm:py-7 md:px-12 md:py-9
                       [@media(max-height:760px)]:!px-9 [@media(max-height:760px)]:!py-4
                       [@media(max-height:700px)]:!py-3"
            style={{
              backgroundImage: `
                url(${starBg.src}),
                linear-gradient(to bottom,
                  #741942 0%,
                  #741942 30%,
                  #4E0228 70%,
                  #2D0117 100%
                )
              `,
              backgroundPosition: 'right top, center',
              backgroundRepeat: 'no-repeat, no-repeat',
              backgroundSize: '150px, cover',
              overflowX: 'hidden',
              overflowY: 'auto',
            }}
          >
            {/* Close Button - Fixed at top-right */}
            {isClosable && (
              <button
                onClick={onClose}
                aria-label="Close pricing"
                className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors z-10
                           w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10"
              >
                ✕
              </button>
            )}
            <AnimatePresence>
              {showSuccessCelebration && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-20 bg-[#2D0117]/90 backdrop-blur-sm flex items-center justify-center"
                >
                  <div className="text-center px-8">
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0, y: 16 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      transition={{ duration: 0.35 }}
                      className="rounded-2xl border border-white/20 bg-white/10 px-8 py-6"
                    >
                      <p className="text-sm text-green-300 font-semibold mb-2">Payment Successful</p>
                      <h2 className="text-white text-2xl font-serif">Your PRO is activated</h2>
                      <p className="text-white/70 text-sm mt-3">Redirecting you to chat...</p>
                    </motion.div>
                  </div>
                  <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    {CONFETTI_PIECES.map((piece) => (
                      <motion.span
                        key={piece.id}
                        className="absolute top-[-12%] h-3 w-2 rounded-sm"
                        style={{
                          left: piece.left,
                          backgroundColor: CONFETTI_COLORS[piece.id % CONFETTI_COLORS.length],
                        }}
                        initial={{ opacity: 0, y: '-8%' }}
                        animate={{
                          opacity: [0, 1, 1, 0.9],
                          y: ['-8%', '118%'],
                          x: [0, piece.drift, 0],
                          rotate: [0, piece.spin],
                        }}
                        transition={{
                          duration: piece.duration,
                          delay: piece.delay,
                          ease: 'easeIn',
                        }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!showEntryCode ? (
              /* Main Pricing View */
              <div className="h-full flex flex-col">
                {/* Header Section */}
                <div className="flex-shrink-0 mb-6 [@media(max-height:760px)]:!mb-3">
                  <div className="flex items-center gap-2">
                    <Image
                      src={meeraLogo}
                      alt={`${process.env.NEXT_PUBLIC_APP_NAME?.toLowerCase()}`}
                      height={24}
                      className="h-5 w-auto sm:h-6"
                    />
                    <span className="text-white font-serif italic text-lg sm:text-xl">
                      {`${process.env.NEXT_PUBLIC_APP_NAME?.toLowerCase()}`}
                    </span>
                  </div>
                </div>

                {/* Main Title */}
                <div className="flex-shrink-0 mb-4 [@media(max-height:760px)]:!mb-2">
                  <h1
                    id="pricing-modal-title"
                    className="text-3xl sm:text-[32px] text-white font-serif font-semibold leading-[1.12] sm:leading-[1.08]
                                 [@media(max-height:760px)]:!text-[28px] [@media(max-height:700px)]:!text-[26px]"
                  >
                    <span className="block">Your Conscious Intelligence (CI)</span>
                    <span className="block">Companion</span>
                  </h1>
                </div>

                {/* Description */}
                <div className="flex-shrink-0 mb-5 sm:mb-8 md:mb-10 [@media(max-height:760px)]:!mb-4 [@media(max-height:700px)]:!mb-3">
                  <p
                    className="text-white text-sm sm:text-base italic font-sans font-semibold leading-relaxed
                                [@media(max-height:760px)]:!text-sm"
                  >
                    A friend that understands you, remembers you, evolves with you.
                  </p>
                </div>

                <div className="flex-grow min-h-0 md:min-h-8 [@media(max-height:760px)]:!min-h-0" />

                {/* Content Section */}
                <div className="flex-shrink-0">
                  {/* Models Available */}
                  <div className="mb-3 sm:mb-4 md:mb-5 [@media(max-height:760px)]:!mb-2">
                    <p className="text-white text-sm sm:text-base font-semibold">7500+ Minds. One Hive Mind.</p>
                  </div>

                  {/* Pricing Plan */}
                  <div className="mb-2 sm:mb-3 md:mb-4 space-y-3 [@media(max-height:760px)]:!mb-2 [@media(max-height:760px)]:!space-y-2">
                    <button
                      onClick={() => setSelectedPlan('monthly')}
                      className="w-full bg-white/10 backdrop-blur-sm border border-white rounded-xl
                                 p-4 flex items-center justify-between [@media(max-height:760px)]:!p-3
                                 hover:bg-white/15 transition-colors"
                    >
                      <div className="flex flex-col items-start">
                        <span className="text-white text-lg sm:text-xl font-medium mb-1 [@media(max-height:760px)]:!mb-0.5 [@media(max-height:760px)]:!text-lg">
                          Monthly
                        </span>
                        <div className="text-white/80 text-base sm:text-lg [@media(max-height:760px)]:!text-base">
                          {getPriceDisplay('monthly', PLAN_PRICES.monthly, discountedPrices.monthly)}
                        </div>
                        <div className="text-white/55 text-[11px] sm:text-xs leading-tight mt-1 [@media(max-height:760px)]:!mt-0.5">
                          Text | Web | Images
                        </div>
                      </div>

                      {selectedPlan === 'monthly' && (
                        <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-3 w-3 sm:h-4 sm:w-4 text-[#741942]"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      )}
                    </button>

                    <button
                      onClick={() => setSelectedPlan('lifetime')}
                      className="w-full bg-white/10 backdrop-blur-sm border border-white rounded-xl
                                 p-4 flex items-center justify-between [@media(max-height:760px)]:!p-3
                                 hover:bg-white/15 transition-colors"
                    >
                      <div className="flex flex-col items-start">
                        <span className="text-white text-lg sm:text-xl font-medium mb-1 [@media(max-height:760px)]:!mb-0.5 [@media(max-height:760px)]:!text-lg">
                          Lifetime
                        </span>
                        <div className="text-white/80 text-base sm:text-lg [@media(max-height:760px)]:!text-base">
                          {getPriceDisplay('lifetime', PLAN_PRICES.lifetime, discountedPrices.lifetime)}
                        </div>
                        <div className="text-white/55 text-[11px] sm:text-xs leading-tight mt-1 [@media(max-height:760px)]:!mt-0.5">
                          Text | Web | Images
                        </div>
                      </div>

                      {selectedPlan === 'lifetime' && (
                        <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-3 w-3 sm:h-4 sm:w-4 text-[#741942]"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      )}
                    </button>
                  </div>

                  {/* Applied Coupon */}
                  {appliedCoupon && (
                    <div
                      className="mb-4 flex items-center justify-between bg-white/10 border border-green-400/30 
                                    px-4 py-3 rounded-lg"
                    >
                      <div className="text-white text-sm">
                        <span>Coupon: {appliedCoupon}</span>
                        <span className="ml-2 text-green-400 font-medium">
                          ({COUPON_CODES[appliedCoupon as keyof typeof COUPON_CODES]}% off)
                        </span>
                      </div>
                      <button
                        onClick={removeCoupon}
                        className="text-red-400 text-sm hover:text-red-300 transition-colors font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>

                {/* Bottom Section */}
                <div className="flex-shrink-0 space-y-2 sm:space-y-3 md:space-y-4 [@media(max-height:760px)]:!space-y-2">
                  {/* Enter Code Button */}
                  <button
                    onClick={() => setShowEntryCode(true)}
                    disabled={isPaymentLoading || showSuccessCelebration}
                    className="w-full text-white/60 py-2.5 md:py-3 rounded-full 
                               text-base sm:text-lg font-medium hover:opacity-90 
                               transition-opacity disabled:opacity-50 disabled:cursor-not-allowed
                               [@media(max-height:760px)]:!py-1.5 [@media(max-height:760px)]:!text-base"
                  >
                    Enter Code
                  </button>

                  {/* Subscribe Button */}
                  <button
                    onClick={handleSubscribe}
                    disabled={isPaymentLoading || showSuccessCelebration}
                    className="w-full bg-[#FDF6F1] text-[#1A0B14] py-3 md:py-3.5 rounded-full 
                               text-base sm:text-lg font-medium hover:opacity-90 
                               transition-opacity disabled:opacity-50 disabled:cursor-not-allowed
                               [@media(max-height:760px)]:!py-2.5 [@media(max-height:760px)]:!text-base"
                  >
                    {isPaymentLoading
                      ? 'Processing...'
                      : getCurrentPrice(selectedPlan) === 0
                        ? 'Continue Our Journey'
                        : 'Continue Our Journey'}
                  </button>

                  {/* Logout */}
                  <div className="flex justify-center items-center gap-2 pt-0 text-xs text-white/40">
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={isPaymentLoading || showSuccessCelebration}
                      className="font-medium tracking-wide text-white/45 transition-colors hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Entry Code View */
              <div className="h-full flex flex-col">
                {/* Header with Back Button */}
                <div className="flex-shrink-0 mb-8">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowEntryCode(false)}
                      disabled={isPaymentLoading || showSuccessCelebration}
                      aria-label="Go back"
                      className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 
                                 flex items-center justify-center transition-colors border border-white/20
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <HiArrowLeft className="text-white text-lg" />
                    </button>

                    <div className="flex items-center gap-2">
                      <Image
                        src={meeraLogo}
                        alt={`${process.env.NEXT_PUBLIC_APP_NAME?.toLowerCase()}`}
                        height={24}
                        className="h-5 w-auto sm:h-6"
                      />
                      <span className="text-white font-serif italic text-lg sm:text-xl">
                        {`${process.env.NEXT_PUBLIC_APP_NAME?.toLowerCase()}`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Main Content */}
                <div className="flex-grow flex flex-col min-h-0">
                  <div className="max-w-sm mx-auto w-full mt-10">
                    <h2 className="text-xl sm:text-2xl text-white font-serif mb-8 text-center">Enter Coupon Code</h2>

                    <div className="space-y-4">
                      <input
                        type="text"
                        value={entryCode}
                        onChange={(e) => setEntryCode(e.target.value.toUpperCase())}
                        disabled={isPaymentLoading || showSuccessCelebration}
                        placeholder="Enter Code"
                        className="w-full bg-white text-[#1A0B14] px-5 py-4 rounded-full 
                                   text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 
                                   focus:ring-white/20 transition-shadow disabled:opacity-50"
                      />

                      <button
                        onClick={handleCouponCode}
                        disabled={isPaymentLoading || showSuccessCelebration || entryCode.length === 0}
                        className={`w-full py-4 rounded-full text-base font-medium transition-all
                                   ${
                                     entryCode.length > 0
                                       ? 'bg-[#491f33] text-white hover:bg-[#5a2640]'
                                       : 'bg-[#491f33]/50 text-white/60 cursor-not-allowed'
                                   } disabled:opacity-50`}
                      >
                        {isPaymentLoading ? 'Verifying...' : 'Apply Coupon'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Logout */}
                <div className="flex-shrink-0 flex justify-center items-center gap-2 pt-4 text-xs text-white/40">
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={isPaymentLoading || showSuccessCelebration}
                    className="font-medium tracking-wide text-white/45 transition-colors hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Logout
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
