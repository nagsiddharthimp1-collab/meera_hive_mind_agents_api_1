'use client';

import { SuccessDialog } from '@/components/SuccessDialog';
import { OpenInBrowserDialog } from '@/components/auth/OpenInBrowserDialog';
import {
  breakAuthRedirectLoop,
  clearAuthRedirectTrace,
  clearGuestTokenState,
  GUEST_TOKEN_COOKIE_KEY,
  getGuestToken,
  hasConsumedSuccessFlag,
  hasSuccessQueryParam,
  logAuthRedirectEvent,
  markSuccessFlagConsumed,
  registerAuthRedirectVisit,
  resolveSignInRouteDecision,
  stripQueryParamsFromCurrentUrl,
  type SessionStatus,
} from '@/lib/authRedirect';
import { supabase } from '@/lib/supabaseClient';
import { startGoogleOAuth } from '@/lib/auth/startGoogleOAuth';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { FcGoogle } from 'react-icons/fc';

function SearchParamsHandler({ enabled }: { enabled: boolean }) {
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const hasSuccess = hasSuccessQueryParam(window.location.search);
    if (!hasSuccess) return;

    if (!hasConsumedSuccessFlag()) {
      setShowSuccessDialog(true);
      markSuccessFlagConsumed();
      logAuthRedirectEvent('success_flag_consumed', {
        pathname: window.location.pathname,
      });
    }

    stripQueryParamsFromCurrentUrl(['success']);
  }, [enabled]);

  return (
    <>
      {showSuccessDialog && (
        <SuccessDialog
          title="Congratulations!"
          description={`You've upgraded to ${process.env.NEXT_PUBLIC_APP_NAME}  Pro.`}
          buttonText="Sign up to access your purchase"
          isOpen={showSuccessDialog}
          onClose={() => setShowSuccessDialog(false)}
        />
      )}
    </>
  );
}

function SignInClient() {
  const searchParams = useSearchParams();
  const referralId = searchParams.get('referral_id');
  const router = useRouter();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const [openInBrowserState, setOpenInBrowserState] = useState<{
    isOpen: boolean;
    openUrl: string;
    browserHint: 'Safari' | 'Chrome';
  }>({
    isOpen: false,
    openUrl: '',
    browserHint: 'Safari',
  });

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSessionStatus(data.session ? 'authenticated' : 'unauthenticated');
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionStatus(session ? 'authenticated' : 'unauthenticated');
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const pathname = window.location.pathname;
    const currentRoute = `${window.location.pathname}${window.location.search}`;
    const guestToken = getGuestToken();

    if (sessionStatus === 'authenticated' && guestToken) {
      clearGuestTokenState('authenticated_sign_in');
    }

    const { loopDetected, visitCount } = registerAuthRedirectVisit(pathname);
    if (loopDetected) {
      const safeTarget = breakAuthRedirectLoop({ pathname, sessionStatus });
      if (safeTarget !== currentRoute) {
        router.replace(safeTarget);
      }
      return;
    }

    const decision = resolveSignInRouteDecision(sessionStatus);
    if (decision.target && decision.target !== currentRoute) {
      logAuthRedirectEvent('redirect_decision', {
        from: pathname,
        hasGuestToken: !!guestToken,
        reason: decision.reason,
        sessionStatus,
        target: decision.target,
        visitCount,
      });
      router.replace(decision.target);
      return;
    }

    if (sessionStatus === 'unauthenticated') {
      clearAuthRedirectTrace();
    }
  }, [router, sessionStatus]);

  const handleGoogleSignIn = async () => {
    try {
      if (referralId) {
        document.cookie = `referral_id=${referralId}; path=/; max-age=3600; SameSite=Lax`;
      }

      const guestToken = getGuestToken();
      if (guestToken) {
        document.cookie = `${GUEST_TOKEN_COOKIE_KEY}=${guestToken}; path=/; max-age=3600; SameSite=Lax`;
      }

      const result = await startGoogleOAuth();
      if (result.status === 'blocked_in_embedded_browser') {
        setOpenInBrowserState({
          isOpen: true,
          openUrl: result.openUrl,
          browserHint: result.browserHint,
        });
      } else if (result.status === 'failed') {
        console.error('Error signing in with Google:', result.message);
      }
    } catch (error) {
      console.error('Error signing in with Google:', error);
    }
  };

  if (sessionStatus !== 'unauthenticated') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-background text-primary">
      <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-[#ed1c24]/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-36 -left-20 h-80 w-80 rounded-full bg-[#49d8cf]/10 blur-3xl" />

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col px-5 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between py-5 sm:py-7">
          <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Meera home">
            <Image
              src="/icons/meera.svg"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8"
              priority
            />
            <span className="font-serif text-[22px] italic tracking-tight">
              {(process.env.NEXT_PUBLIC_APP_NAME || 'meera').toLowerCase()}
            </span>
          </Link>

          <span className="rounded-full border border-primary/10 bg-white/55 px-3 py-1.5 text-[11px] font-medium tracking-wide text-primary/70 backdrop-blur-sm sm:text-xs">
            7,850+ Minds
          </span>
        </header>

        <section className="grid flex-1 items-center gap-7 pb-8 pt-2 sm:gap-10 sm:pb-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14 lg:py-10">
          <div className="order-2 mx-auto w-full max-w-xl text-center lg:order-1 lg:mx-0 lg:text-left">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary/55 sm:mb-4">
              Meera · Your personal companion
            </p>

            <h1 className="text-balance font-serif text-[clamp(2.5rem,7vw,4.9rem)] font-normal leading-[0.98] tracking-[-0.035em]">
              Someone to talk to, whenever you need.
            </h1>

            <p className="mx-auto mt-5 max-w-lg text-[15px] leading-7 text-primary/68 sm:text-lg sm:leading-8 lg:mx-0">
              Talk through bad days, learn something new, or simply have someone to talk to.
            </p>

            <div className="mx-auto mt-6 flex max-w-lg flex-wrap justify-center gap-2 lg:mx-0 lg:justify-start">
              {['Talk through bad days', 'Learn something new', 'Simply talk'].map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-primary/10 bg-white/55 px-3.5 py-2 text-xs text-primary/75 shadow-[0_8px_24px_rgba(12,60,38,0.04)] backdrop-blur-sm sm:text-sm"
                >
                  {item}
                </span>
              ))}
            </div>

            <button
              onClick={handleGoogleSignIn}
              className={cn(
                'group relative mx-auto mt-7 flex h-14 w-full max-w-md cursor-pointer items-center justify-center rounded-full bg-primary px-8 text-base font-medium text-background shadow-[0_14px_35px_rgba(12,60,38,0.18)] transition-all duration-200',
                'hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(12,60,38,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background lg:mx-0',
              )}
            >
              <FcGoogle className="absolute left-5 rounded-full bg-white p-1 text-[28px]" aria-hidden="true" />
              <span>Talk to Meera</span>
              <span className="ml-2 transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true">
                →
              </span>
            </button>

            <p className="mt-3 text-xs text-primary/45">Continue securely with Google</p>

            <div className="mx-auto mt-7 max-w-lg border-t border-primary/10 pt-5 lg:mx-0">
              <p className="text-sm leading-6 text-primary/62">
                Powered by <span className="font-semibold text-primary">Conscious Intelligence (CI)</span>{' '}
                through the Hive Mind — 7,850+ Minds.
              </p>
            </div>
          </div>

          <div className="order-1 flex items-center justify-center lg:order-2">
            <div className="relative w-full max-w-[430px] sm:max-w-[520px]">
              <div className="absolute inset-[12%] rounded-full bg-white/50 blur-2xl" />
              <div className="relative rounded-[32px] border border-primary/[0.07] bg-white/25 px-2 py-3 shadow-[0_24px_80px_rgba(12,60,38,0.08)] backdrop-blur-sm sm:px-6 sm:py-7 lg:rounded-[44px]">
                <Image
                  src="/images/home.svg"
                  alt="People sharing thoughts, questions, and feelings with Meera"
                  width={636}
                  height={700}
                  priority
                  sizes="(max-width: 1024px) 92vw, 50vw"
                  className="mx-auto h-auto w-full max-h-[42vh] object-contain sm:max-h-[50vh] lg:max-h-[620px]"
                />
              </div>
            </div>
          </div>
        </section>

        <footer className="flex flex-col items-center justify-between gap-3 border-t border-primary/[0.08] py-5 text-xs text-primary/50 sm:flex-row">
          <span>Meera · Your personal companion</span>
          <nav className="flex items-center gap-5" aria-label="Legal">
            <Link href="/whitepaper" className="transition-colors hover:text-primary">
              Whitepaper
            </Link>
            <Link href="/terms" className="transition-colors hover:text-primary">
              Terms
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-primary">
              Privacy
            </Link>
          </nav>
        </footer>
      </div>
      <OpenInBrowserDialog
        isOpen={openInBrowserState.isOpen}
        openUrl={openInBrowserState.openUrl}
        browserHint={openInBrowserState.browserHint}
        onClose={() =>
          setOpenInBrowserState((prev) => ({
            ...prev,
            isOpen: false,
          }))
        }
      />
      <SearchParamsHandler enabled={sessionStatus === 'unauthenticated'} />
    </main>
  );
}

export default function SignIn() {
  return (
    <Suspense fallback={null}>
      <SignInClient />
    </Suspense>
  );
}
