import Link from 'next/link';

export function PublicSiteFallback() {
  return (
    <main className="flex min-h-[100dvh] items-center bg-background px-5 py-12 text-primary sm:px-9">
      <div className="mx-auto w-full max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary/60">Meera</p>
        <h1 className="mt-5 font-serif text-5xl tracking-tight sm:text-6xl">Your personal AI companion</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-primary/70">
          Talk through your day, explore information from the web, and create images with Meera.
        </p>
        <p className="mt-6 text-sm text-primary/70">Meera is provided by Meera Labs Inc., a Delaware corporation.</p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link href="/sign-in" className="rounded-full bg-primary px-6 py-3 font-semibold text-background">Talk to Meera</Link>
          <Link href="/pricing" className="rounded-full border border-primary/30 px-6 py-3 font-semibold">View plans</Link>
        </div>
        <nav aria-label="Business and legal information" className="mt-14 flex flex-wrap gap-5 border-t border-primary/15 pt-6 text-sm">
          <Link href="/pricing" className="underline underline-offset-4">Pricing</Link>
          <Link href="/terms" className="underline underline-offset-4">Terms</Link>
          <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>
          <Link href="/refund-policy" className="underline underline-offset-4">Refunds and cancellations</Link>
          <a href="mailto:siddharth.nag@himeera.com" className="underline underline-offset-4">Support</a>
        </nav>
      </div>
    </main>
  );
}
