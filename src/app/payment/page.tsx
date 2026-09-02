'use client';

import { PricingModalProvider, usePricingModal } from '@/contexts/PricingModalContext';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import {
  clearAuthRedirectTrace,
  logAuthRedirectEvent,
  resolvePaymentRouteDecision,
  type SessionStatus,
} from '@/lib/authRedirect';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import React, { Suspense, useEffect, useRef, useState } from 'react';

function PaymentRouteContent() {
  const { data: subscriptionData, isLoading: isLoadingSubscription } = useSubscriptionStatus();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const [sessionUserId, setSessionUserId] = useState<string>('');
  const [sessionAccessToken, setSessionAccessToken] = useState<string>('');
  const { openModal } = usePricingModal();
  const router = useRouter();
  const modalOpenedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSessionStatus(data.session ? 'authenticated' : 'unauthenticated');
      setSessionUserId(data.session?.user?.id ?? '');
      setSessionAccessToken(data.session?.access_token ?? '');
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionStatus(session ? 'authenticated' : 'unauthenticated');
      setSessionUserId(session?.user?.id ?? '');
      setSessionAccessToken(session?.access_token ?? '');
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const decision = resolvePaymentRouteDecision({
      sessionStatus,
      isSubscriptionLoading: isLoadingSubscription,
      subscriptionData,
    });

    const currentRoute = `${window.location.pathname}${window.location.search}`;

    if (decision.target && decision.target !== currentRoute) {
      logAuthRedirectEvent('redirect_decision', {
        from: window.location.pathname,
        reason: decision.reason,
        sessionStatus,
        target: decision.target,
        requiresPaymentForChat: subscriptionData?.requires_payment_for_chat ?? null,
      });
      router.replace(decision.target);
      return;
    }

    if (decision.reason === 'payment_required' && !modalOpenedRef.current) {
      modalOpenedRef.current = true;
      void fetch('/api/analytics/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionAccessToken ? { Authorization: `Bearer ${sessionAccessToken}` } : {}),
        },
        body: JSON.stringify({
          event_name: 'payment_page_opened',
          user_id: sessionUserId || null,
          source: 'payment_route',
          metadata: {
            route: window.location.pathname,
            requires_payment_for_chat: subscriptionData?.requires_payment_for_chat ?? null,
          },
        }),
      }).catch(() => {
        // Best-effort telemetry: do not block checkout UI.
      });
      openModal('paywall_route', false);
    }

    if (sessionStatus === 'authenticated' && decision.reason !== 'payment_required') {
      clearAuthRedirectTrace();
    }
  }, [isLoadingSubscription, openModal, router, sessionAccessToken, sessionStatus, sessionUserId, subscriptionData]);

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-6 text-center">
      <div>
        <div className="w-8 h-8 mx-auto border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        <p className="mt-4 text-sm text-primary/80">Preparing secure checkout…</p>
      </div>
    </div>
  );
}

export default function PaymentPage() {
  return (
    <PricingModalProvider>
      <Suspense
        fallback={
          <div className="min-h-[100dvh] flex items-center justify-center bg-background">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        }
      >
        <PaymentRouteContent />
      </Suspense>
    </PricingModalProvider>
  );
}
