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
import { Suspense, useEffect, useRef, useState } from 'react';
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

const testimonials = [
  {
    quote:
      "I was talking to her for ten minutes and didn't even realise the time had passed. I honestly needed someone to talk to—and she helped a lot.",
    name: 'Ananya',
    city: 'Bengaluru',
    code: 'BLR',
    country: 'India',
    coordinates: '12.97° N  ·  77.59° E',
  },
  {
    quote: 'The way she listens and asks questions feels very real.',
    name: 'Rhea',
    city: 'Berlin',
    code: 'BER',
    country: 'Germany',
    coordinates: '52.52° N  ·  13.40° E',
  },
  {
    quote: 'It felt like someone was really listening.',
    name: 'Ishaan',
    city: 'Toronto',
    code: 'YYZ',
    country: 'Canada',
    coordinates: '43.65° N  ·  79.38° W',
  },
  {
    quote: "She talks like a companion and tries to understand how I feel. I'd definitely come back whenever I feel low.",
    name: 'Mehak',
    city: 'Singapore',
    code: 'SIN',
    country: 'Singapore',
    coordinates: '1.35° N  ·  103.82° E',
  },
  {
    quote: 'I had quite a deep conversation with Meera.',
    name: 'Nikhil',
    city: 'London',
    code: 'LDN',
    country: 'United Kingdom',
    coordinates: '51.51° N  ·  0.13° W',
  },
] as const;

function SignInClient() {
  const searchParams = useSearchParams();
  const referralId = searchParams.get('referral_id');
  const router = useRouter();
  const testimonialRailRef = useRef<HTMLDivElement>(null);
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

  const moveTestimonials = (direction: -1 | 1) => {
    const rail = testimonialRailRef.current;
    if (!rail) return;

    rail.scrollBy({
      left: direction * Math.min(rail.clientWidth * 0.84, 820),
      behavior: 'smooth',
    });
  };

  if (sessionStatus !== 'unauthenticated') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="bg-background text-primary">
      <section className="relative min-h-[100dvh] overflow-hidden">
        <div className="pointer-events-none absolute -right-36 -top-44 h-[28rem] w-[28rem] rounded-full bg-[#ed1c24]/[0.07] blur-3xl" />

        <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col px-5 sm:px-9 lg:px-14">
          <header className="flex h-20 items-center justify-between sm:h-24">
            <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Meera home">
              <Image src="/icons/meera.svg" alt="" width={34} height={34} className="h-8 w-8 sm:h-9 sm:w-9" priority />
              <span className="font-serif text-[22px] italic tracking-tight sm:text-2xl">
                {(process.env.NEXT_PUBLIC_APP_NAME || 'meera').toLowerCase()}
              </span>
            </Link>

            <a
              href="#intelligence"
              className="text-xs font-medium tracking-wide text-primary/55 transition-colors hover:text-primary sm:text-sm"
            >
              About Meera
            </a>
          </header>

          <div className="grid flex-1 items-center gap-8 pb-10 pt-3 sm:gap-12 sm:pb-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:pb-16 lg:pt-0">
            <div className="mx-auto w-full max-w-xl text-center lg:mx-0 lg:text-left">
              <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.28em] text-primary/45 sm:text-xs">
                Meet Meera
              </p>

              <h1 className="text-balance font-serif text-[clamp(3.25rem,8vw,6.75rem)] font-normal leading-[0.9] tracking-[-0.045em]">
                Your personal companion.
              </h1>

              <p className="mx-auto mt-7 max-w-lg text-base leading-7 text-primary/62 sm:text-lg sm:leading-8 lg:mx-0">
                Talk through bad days, learn something new, or simply have someone to talk to.
              </p>

              <button
                onClick={handleGoogleSignIn}
                className={cn(
                  'group relative mx-auto mt-8 flex h-14 w-full max-w-sm cursor-pointer items-center justify-center rounded-full bg-primary px-8 text-[15px] font-medium text-background transition-all duration-300 lg:mx-0',
                  'shadow-[0_16px_40px_rgba(12,60,38,0.16)] hover:-translate-y-0.5 hover:shadow-[0_20px_46px_rgba(12,60,38,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background',
                )}
              >
                <FcGoogle className="absolute left-5 rounded-full bg-white p-1 text-[28px]" aria-hidden="true" />
                <span>Talk to Meera</span>
                <span className="ml-2 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true">
                  →
                </span>
              </button>

              <p className="mt-3 text-[11px] tracking-wide text-primary/38">Continue securely with Google</p>
            </div>

            <div className="relative flex items-center justify-center">
              <div className="pointer-events-none absolute inset-[18%] rounded-full bg-white/70 blur-3xl" />
              <Image
                src="/images/home.svg"
                alt="People sharing thoughts, questions, and feelings with Meera"
                width={636}
                height={700}
                priority
                sizes="(max-width: 1024px) 92vw, 54vw"
                className="relative mx-auto h-auto w-full max-w-[520px] drop-shadow-[0_28px_50px_rgba(12,60,38,0.08)] sm:max-w-[590px] lg:max-w-[650px]"
              />
            </div>
          </div>

          <a
            href="#intelligence"
            aria-label="Discover more about Meera"
            className="mb-6 hidden self-center text-[10px] uppercase tracking-[0.3em] text-primary/35 transition-colors hover:text-primary/70 lg:block"
          >
            Discover ↓
          </a>
        </div>
      </section>

      <section id="intelligence" className="relative overflow-hidden border-t border-primary/[0.07] bg-[#f4ede3]">
        <div className="pointer-events-none absolute -bottom-40 -left-36 h-[30rem] w-[30rem] rounded-full bg-[#49d8cf]/[0.08] blur-3xl" />

        <div className="relative mx-auto w-full max-w-7xl px-5 py-20 sm:px-9 sm:py-28 lg:px-14 lg:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary/45 sm:text-xs">
              Whatever the day brings
            </p>
            <h2 className="mt-5 text-balance font-serif text-[clamp(2.5rem,6vw,5.25rem)] font-normal leading-[0.98] tracking-[-0.04em]">
              A conversation can change how a moment feels.
            </h2>
          </div>

          <div className="mx-auto mt-16 grid max-w-6xl border-y border-primary/10 sm:grid-cols-3 sm:divide-x sm:divide-primary/10 lg:mt-20">
            {[
              ['01', 'On difficult days', 'Talk things through, honestly and at your own pace.'],
              ['02', 'When curiosity strikes', 'Ask, explore, and learn something you did not know before.'],
              ['03', 'In quiet moments', 'Share what is on your mind, even when you do not know where to begin.'],
            ].map(([number, title, description]) => (
              <article
                key={number}
                className="grid grid-cols-[2.5rem_1fr] gap-4 border-b border-primary/10 py-8 last:border-b-0 sm:block sm:border-b-0 sm:px-8 sm:py-10 lg:px-12 lg:py-14"
              >
                <span className="font-serif text-sm italic text-primary/35">{number}</span>
                <div>
                  <h3 className="font-serif text-2xl leading-tight sm:mt-8 sm:text-[1.7rem]">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-primary/55">{description}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="mx-auto mt-24 max-w-6xl sm:mt-32 lg:mt-40">
            <div className="grid items-end gap-8 border-b border-primary/10 pb-10 sm:pb-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-primary/40 sm:text-xs">
                  Voices across cities
                </p>
                <p className="mt-4 text-xs leading-5 text-primary/40">Swipe or drag to move sideways</p>
              </div>
              <h2 className="text-balance font-serif text-[clamp(2.8rem,6vw,5.6rem)] font-normal leading-[0.92] tracking-[-0.045em]">
                Different places. The same feeling of being heard.
              </h2>
            </div>

            <div className="mt-5 flex items-center justify-between gap-6">
              <p className="text-[10px] uppercase tracking-[0.22em] text-primary/32">01 — 05</p>
              <div className="flex gap-2" aria-label="Testimonial controls">
                <button
                  type="button"
                  onClick={() => moveTestimonials(-1)}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/12 text-lg text-primary/55 transition-colors hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="Previous testimonial"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => moveTestimonials(1)}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/12 text-lg text-primary/55 transition-colors hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="Next testimonial"
                >
                  →
                </button>
              </div>
            </div>

            <div
              ref={testimonialRailRef}
              className="hide-scrollbar -mx-5 mt-5 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-5 pb-2 sm:-mx-9 sm:gap-5 sm:px-9 lg:mx-0 lg:px-0"
              aria-label="What people say about Meera"
              tabIndex={0}
            >
              {testimonials.map((testimonial, index) => (
                <article
                  key={testimonial.name}
                  className={cn(
                    'relative flex min-h-[28rem] w-[84vw] max-w-[47rem] shrink-0 snap-start snap-always flex-col justify-between overflow-hidden rounded-[2rem] border p-7 sm:min-h-[32rem] sm:w-[68vw] sm:rounded-[2.5rem] sm:p-10 lg:w-[56vw] lg:p-12',
                    index === 3
                      ? 'border-primary bg-primary text-background'
                      : 'border-primary/10 bg-background/60 text-primary',
                  )}
                >
                  <div
                    aria-hidden="true"
                    className={cn(
                      'absolute inset-0 opacity-[0.045]',
                      index === 3
                        ? 'bg-[linear-gradient(rgba(255,255,255,0.75)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.75)_1px,transparent_1px)]'
                        : 'bg-[linear-gradient(rgba(12,60,38,0.85)_1px,transparent_1px),linear-gradient(90deg,rgba(12,60,38,0.85)_1px,transparent_1px)]',
                    )}
                    style={{ backgroundSize: '36px 36px' }}
                  />

                  <div className="relative flex items-start justify-between gap-6">
                    <div>
                      <p
                        className={cn(
                          'text-[10px] font-semibold uppercase tracking-[0.28em]',
                          index === 3 ? 'text-background/45' : 'text-primary/38',
                        )}
                      >
                        Voice {String(index + 1).padStart(2, '0')}
                      </p>
                      <p className="mt-2 text-xs uppercase tracking-[0.16em] opacity-45">{testimonial.country}</p>
                    </div>
                    <span className="font-serif text-[3.7rem] leading-none tracking-[-0.06em] opacity-[0.13] sm:text-[5.5rem]">
                      {testimonial.code}
                    </span>
                  </div>

                  <blockquote className="relative my-12 max-w-[38rem] font-serif text-[clamp(2rem,4.2vw,4rem)] leading-[1.02] tracking-[-0.035em]">
                    “{testimonial.quote}”
                  </blockquote>

                  <div
                    className={cn(
                      'relative flex flex-col gap-5 border-t pt-6 sm:flex-row sm:items-end sm:justify-between',
                      index === 3 ? 'border-background/15' : 'border-primary/10',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="h-2 w-2 rounded-full bg-[#ed1c24]" aria-hidden="true" />
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em]">
                        {testimonial.name} <span className="mx-1.5 opacity-35">·</span> {testimonial.city}
                      </p>
                    </div>
                    <p className="text-[9px] uppercase tracking-[0.18em] opacity-35">{testimonial.coordinates}</p>
                  </div>
                </article>
              ))}
            </div>

            <p className="mt-6 text-[10px] tracking-[0.16em] text-primary/30">
              Names and locations changed for privacy · Responses lightly edited for clarity
            </p>
          </div>

          <div className="relative mx-auto mt-24 max-w-6xl overflow-hidden rounded-[2rem] bg-primary text-background sm:mt-32 sm:rounded-[3rem] lg:mt-40">
            <div
              aria-hidden="true"
              className="absolute -right-14 -top-14 h-40 w-40 rounded-full bg-[radial-gradient(circle_at_32%_28%,#ff6568_0%,#ed1c24_34%,#6d0005_66%,#080000_100%)] opacity-90 shadow-[0_0_90px_rgba(237,28,36,0.26)] sm:-right-12 sm:-top-20 sm:h-64 sm:w-64 lg:right-8 lg:top-8"
            />
            <div aria-hidden="true" className="absolute bottom-0 left-1/2 h-px w-[82%] -translate-x-1/2 bg-background/12" />

            <div className="relative px-7 py-11 sm:px-12 sm:py-16 lg:px-16 lg:py-20">
              <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-background/45 sm:text-xs">
                The Hive Mind
              </p>

              <div className="mt-12 sm:mt-16 lg:mt-20">
                <p className="font-serif text-[clamp(5.5rem,16vw,11rem)] font-normal leading-[0.68] tracking-[-0.07em]">
                  7,850+
                </p>
                <h2 className="mt-7 max-w-3xl font-serif text-[clamp(2.5rem,6vw,5.5rem)] font-normal leading-[0.92] tracking-[-0.045em] sm:mt-10">
                  Minds. One Hive Mind.
                </h2>
              </div>

              <div className="mt-12 flex flex-col gap-8 border-t border-background/15 pt-7 sm:mt-16 sm:flex-row sm:items-center sm:justify-between sm:pt-8">
                <p className="max-w-md text-sm leading-6 text-background/58 sm:text-base">
                  Powered by Conscious Intelligence (CI).
                </p>

                <button
                  onClick={handleGoogleSignIn}
                  className="group flex h-14 w-full items-center justify-center rounded-full bg-background px-7 text-sm font-semibold text-primary transition-transform duration-300 hover:-translate-y-0.5 sm:w-52"
                >
                  Talk to Meera
                  <span className="ml-2 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true">
                    →
                  </span>
                </button>
              </div>
            </div>
          </div>

          <footer className="mt-16 flex flex-col items-center justify-between gap-5 border-t border-primary/10 pt-7 text-xs text-primary/45 sm:flex-row sm:mt-20">
            <div className="inline-flex items-center gap-2">
              <Image src="/icons/meera.svg" alt="" width={20} height={20} className="h-5 w-5" />
              <span>Meera · Your personal companion</span>
            </div>
            <nav className="flex items-center gap-6" aria-label="Legal">
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
      </section>
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
