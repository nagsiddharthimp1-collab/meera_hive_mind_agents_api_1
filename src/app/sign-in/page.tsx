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

const conversationMoments = [
  {
    number: '01',
    title: 'On difficult days',
    description: 'Talk things through, honestly and at your own pace.',
    response: "I'm listening.",
  },
  {
    number: '02',
    title: 'When curiosity strikes',
    description: 'Ask, explore, and learn something you did not know before.',
    response: "Let's explore.",
  },
  {
    number: '03',
    title: 'In quiet moments',
    description: 'Share what is on your mind, even when you do not know where to begin.',
    response: 'You can start anywhere.',
  },
] as const;

function SignInClient() {
  const searchParams = useSearchParams();
  const referralId = searchParams.get('referral_id');
  const router = useRouter();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const [activeMoment, setActiveMoment] = useState(0);
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

        <div className="relative mx-auto w-full max-w-[1180px] px-5 py-20 sm:px-8 sm:py-28 lg:px-0 lg:py-32">
          <div className="max-w-3xl lg:grid lg:max-w-none lg:grid-cols-[0.8fr_1.2fr] lg:items-end lg:gap-20">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary/45 sm:text-xs">
              Whatever the day brings
            </p>
            <h2 className="mt-5 text-balance font-serif text-[clamp(2.75rem,5.5vw,5.5rem)] font-normal leading-[0.96] tracking-[-0.045em] lg:mt-0">
              A conversation can change how a moment feels.
            </h2>
          </div>

          <div className="mt-16 grid items-stretch gap-10 lg:mt-24 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16">
            <div className="border-y border-primary/12">
              {conversationMoments.map((moment, index) => {
                const isActive = activeMoment === index;

                return (
                  <button
                    key={moment.number}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setActiveMoment(index)}
                    onMouseEnter={() => setActiveMoment(index)}
                    onFocus={() => setActiveMoment(index)}
                    className="group grid w-full grid-cols-[2.5rem_1fr_auto] gap-4 border-b border-primary/10 py-7 text-left last:border-b-0 sm:grid-cols-[3.5rem_1fr_auto] sm:py-8"
                  >
                    <span className="pt-1 font-serif text-sm italic text-primary/32">{moment.number}</span>
                    <span>
                      <span className="block font-serif text-2xl leading-tight sm:text-[1.8rem]">{moment.title}</span>
                      <span className="mt-2 block max-w-sm text-sm leading-6 text-primary/50">{moment.description}</span>
                      <span
                        className={cn(
                          'mt-4 items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary transition-all duration-300 lg:hidden',
                          isActive ? 'flex' : 'hidden',
                        )}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-[#ed1c24]" />
                        Meera: {moment.response}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-1 flex h-8 w-8 items-center justify-center rounded-full border text-sm transition-all duration-300',
                        isActive
                          ? 'rotate-45 border-primary bg-primary text-background'
                          : 'border-primary/15 text-primary/45 group-hover:border-primary/35',
                      )}
                    >
                      +
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative hidden min-h-[520px] items-center justify-center overflow-hidden rounded-[2.75rem] border border-primary/[0.08] bg-white/30 lg:flex">
              <div aria-hidden="true" className="absolute h-[27rem] w-[27rem] rounded-full border border-primary/[0.07]" />
              <div aria-hidden="true" className="absolute h-[19rem] w-[19rem] rounded-full border border-primary/[0.09]" />
              <div aria-hidden="true" className="absolute h-[11rem] w-[11rem] rounded-full bg-primary/[0.05]" />
              <span aria-hidden="true" className="absolute left-[18%] top-[23%] h-3 w-3 rounded-full bg-[#49d8cf] shadow-[0_0_28px_rgba(73,216,207,0.7)]" />
              <span aria-hidden="true" className="absolute bottom-[20%] right-[21%] h-2 w-2 rounded-full bg-[#edb76c] shadow-[0_0_24px_rgba(237,183,108,0.7)]" />

              <div
                aria-hidden="true"
                className="relative h-28 w-28 rounded-full bg-[radial-gradient(circle_at_32%_28%,#ff6568_0%,#ed1c24_34%,#6d0005_68%,#080000_100%)] shadow-[0_26px_55px_rgba(70,0,0,0.25)]"
              />

              <div
                key={conversationMoments[activeMoment].response}
                className="meera-response absolute right-[8%] top-[17%] max-w-[15rem] rounded-full border border-primary/10 bg-background px-6 py-4 text-center font-serif text-2xl shadow-[0_18px_50px_rgba(12,60,38,0.1)]"
              >
                {conversationMoments[activeMoment].response}
              </div>
              <div aria-hidden="true" className="absolute bottom-8 left-10 text-[10px] uppercase tracking-[0.28em] text-primary/35">
                Meera is here
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-primary text-background">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(250,243,233,0.2) 1px, transparent 1.5px)',
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(circle at 82% 42%, black 0%, transparent 58%)',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-[radial-gradient(circle_at_32%_28%,#ff6568_0%,#ed1c24_34%,#6d0005_68%,#080000_100%)] shadow-[0_0_120px_rgba(237,28,36,0.3)] sm:-right-8 sm:-top-16 sm:h-80 sm:w-80 lg:right-[7%] lg:top-1/2 lg:h-[25rem] lg:w-[25rem] lg:-translate-y-1/2"
        />

        <div className="relative mx-auto grid min-h-[92dvh] w-full max-w-[1180px] items-end gap-16 px-5 py-24 sm:px-8 sm:py-32 lg:min-h-[860px] lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-24 lg:px-0 lg:py-36">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-background/45 sm:text-xs">
              The intelligence behind Meera
            </p>
            <p className="mt-16 font-serif text-[clamp(6rem,17vw,13rem)] font-normal leading-[0.66] tracking-[-0.075em] sm:mt-20 lg:mt-28">
              7,850+
            </p>
            <p className="mt-6 text-sm text-background/50">Contributing minds and growing.</p>
          </div>

          <div className="relative z-10 border-t border-background/18 pt-8 lg:border-l lg:border-t-0 lg:pl-14 lg:pt-0">
            <h2 className="text-balance font-serif text-[clamp(2.8rem,6vw,5.7rem)] font-normal leading-[0.92] tracking-[-0.05em]">
              Minds. One Hive Mind. One companion for you.
            </h2>
            <p className="mt-7 max-w-md text-sm leading-7 text-background/58 sm:text-base">
              Powered by Conscious Intelligence (CI), bringing many minds into one thoughtful presence.
            </p>

            <button
              onClick={handleGoogleSignIn}
              className="group mt-10 flex h-14 w-full items-center justify-center rounded-full bg-background px-7 text-sm font-semibold text-primary transition-transform duration-300 hover:-translate-y-0.5 sm:w-56"
            >
              Talk to Meera
              <span className="ml-2 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true">
                →
              </span>
            </button>
          </div>
        </div>
      </section>

      <footer className="bg-[#f4ede3]">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col items-center justify-between gap-5 px-5 py-8 text-xs text-primary/45 sm:flex-row sm:px-8 lg:px-0">
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
        </div>
      </footer>
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
